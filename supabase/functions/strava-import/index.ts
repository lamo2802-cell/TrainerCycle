import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Imports the signed-in user's recent Strava runs and rides into completed_rides (source = 'strava'),
// so they count in TrainerCycle's training load. Anything that overlaps a session already in
// TrainerCycle is skipped: that's a ride recorded here and uploaded to Strava (or recorded on a
// second device at the same time), so importing it would double count. Rides use power for TSS when
// Strava has real power, otherwise heart rate against the rider's threshold heart rate.
// Needs the activity:read_all scope; connections made before imports were supported only have
// activity:write and get { needsReconnect: true }.
// POST {} -> { imported: [rows], needsReconnect?: true }

const CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") ?? "";
const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const RIDE_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const FEEL_DEFAULT_IF = 0.76; // no pace to go on: treat as a steady run
const RIDE_DEFAULT_IF = 0.7;  // no power or heart rate: treat as an endurance ride
const LTHR_FROM_MAX = 0.87;   // rough cycling threshold heart rate from the highest heart rate seen
const SINCE_KEY = "strava_import_since";
const IGNORED_KEY = "strava_import_ignored"; // imports the rider deleted, so they don't come back

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function refreshTokenIfNeeded(admin: any, userId: string, conn: any) {
  const now = Math.floor(Date.now() / 1000);
  if (conn.expires_at > now + 60) return conn;
  const resp = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  if (!resp.ok) throw new Error("Failed to refresh Strava token: " + resp.status);
  const data = await resp.json();
  await admin.from("strava_connections").update({
    access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at,
  }).eq("user_id", userId);
  return { ...conn, access_token: data.access_token, expires_at: data.expires_at };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const [{ data: conn }, { data: sub }, { data: settingRows }] = await Promise.all([
      admin.from("strava_connections").select("*").eq("user_id", user.id).maybeSingle(),
      admin.from("subscriptions").select("status").eq("user_id", user.id).maybeSingle(),
      admin.from("settings").select("key,value").eq("user_id", user.id).in("key", ["run_threshold_pace", "ftp", "threshold_hr", SINCE_KEY, IGNORED_KEY]),
    ]);
    const setting = (k: string) => (settingRows ?? []).find((r: { key: string }) => r.key === k)?.value?.v;
    if (!conn) return json({ error: "Strava not connected" }, 400);
    // Same rule as saving a ride: only active, trialing or owner accounts add history.
    if (!sub || !["active", "trialing", "owner"].includes(sub.status)) return json({ imported: [] });
    const scope: string = conn.scope ?? "";
    if (!scope.split(",").some((s) => s === "activity:read_all" || s === "activity:read")) return json({ imported: [], needsReconnect: true });

    const fresh = await refreshTokenIfNeeded(admin, user.id, conn);

    // Look back two days before the last sync (activities can be uploaded late), or 60 days the first time.
    const syncedAt = Date.parse(setting(SINCE_KEY) ?? "");
    const since = syncedAt ? syncedAt - 2 * 86400000 : Date.now() - 60 * 86400000;
    const after = Math.floor(since / 1000);
    const startedSync = new Date().toISOString();

    // deno-lint-ignore no-explicit-any
    const activities: any[] = [];
    for (let page = 1; page <= 3; page++) {
      const resp = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${fresh.access_token}` } });
      if (resp.status === 401 || resp.status === 403) return json({ imported: [], needsReconnect: true });
      if (!resp.ok) throw new Error("Strava activities failed: " + resp.status);
      const list = await resp.json();
      activities.push(...list);
      if (list.length < 100) break;
    }
    const sportOf = (a: { sport_type?: string; type?: string }) => {
      const t = a.sport_type ?? a.type ?? "";
      return RUN_TYPES.has(t) ? "run" : RIDE_TYPES.has(t) ? "ride" : null;
    };
    const wanted = activities.filter((a) => sportOf(a) && (a.moving_time || a.elapsed_time));
    const saveSince = () => admin.from("settings").upsert({ user_id: user.id, key: SINCE_KEY, value: { v: startedSync }, updated_at: startedSync }, { onConflict: "user_id,key" });
    if (!wanted.length) { await saveSince(); return json({ imported: [] }); }

    // Everything already in TrainerCycle around these dates, to spot imports and overlaps.
    const earliest = Math.min(...wanted.map((a) => Date.parse(a.start_date))) - 86400000;
    const { data: existing } = await admin.from("completed_rides").select("started_at,duration_sec,sport,source,external_id,max_hr")
      .eq("user_id", user.id).gte("started_at", new Date(earliest).toISOString());
    const have = new Set([...(existing ?? []).map((r: { external_id: string | null }) => r.external_id).filter(Boolean), ...(setting(IGNORED_KEY) ?? [])]);
    const ours = (existing ?? []).filter((r: { source: string | null }) => r.source !== "strava");
    const SLACK = 5 * 60000;
    // deno-lint-ignore no-explicit-any
    const duplicate = (a: any, sport: string) => {
      const s0 = Date.parse(a.start_date), s1 = s0 + (a.elapsed_time || a.moving_time) * 1000;
      return ours.some((r: { started_at: string; duration_sec: number; sport: string }) => {
        const r0 = Date.parse(r.started_at), r1 = r0 + (r.duration_sec || 0) * 1000;
        if (s0 < r1 + SLACK && r0 < s1 + SLACK) return true;
        // Runs logged by hand only have a rough start time: same sport, same day, similar length.
        return sport === "run" && r.sport === "run" && Math.abs(r0 - s0) < 14 * 3600000
          && Math.abs((r.duration_sec || 0) - (a.moving_time || a.elapsed_time)) <= 0.3 * (a.moving_time || a.elapsed_time);
      });
    };

    const pace = Number(setting("run_threshold_pace")) || null;
    const ftp = Number(setting("ftp")) || null;
    // Threshold heart rate: the rider's own setting, else estimated from the highest heart rate we've seen.
    let lthr = Number(setting("threshold_hr")) || null;
    if (!lthr) {
      const { data: hrRows } = await admin.from("completed_rides").select("max_hr").eq("user_id", user.id)
        .gte("started_at", new Date(Date.now() - 365 * 86400000).toISOString()).not("max_hr", "is", null).order("max_hr", { ascending: false }).limit(1);
      const maxSeen = Math.max(Number(hrRows?.[0]?.max_hr) || 0, ...wanted.map((a) => Number(a.max_heartrate) || 0));
      if (maxSeen >= 150) lthr = Math.round(maxSeen * LTHR_FROM_MAX);
    }
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const rows = wanted.filter((a) => !have.has("strava:" + a.id) && !duplicate(a, sportOf(a)!)).map((a) => {
      const sport = sportOf(a)!;
      const dur = Math.round(a.moving_time || a.elapsed_time || 0);
      const dist = Math.round(a.distance || 0);
      const hr = a.average_heartrate ? Math.round(a.average_heartrate) : null;
      // Strava estimates power for rides without a meter; only trust it when it came from a device.
      const realPower = sport === "ride" && a.device_watts && a.average_watts;
      const np = realPower ? Math.round(a.weighted_average_watts || a.average_watts) : null;
      let IF = sport === "run" ? FEEL_DEFAULT_IF : RIDE_DEFAULT_IF;
      if (sport === "run" && pace && dur > 0 && dist > 0) IF = clamp(pace / (dur / (dist / 1000)), 0.4, 1.15);
      else if (np && ftp) IF = clamp(np / ftp, 0.3, 1.3);
      else if (sport === "ride" && hr && lthr) IF = clamp(hr / lthr, 0.45, 1.1);
      return {
        id: "strava_" + a.id, user_id: user.id, sport, source: "strava", external_id: "strava:" + a.id,
        category: sport === "run" ? "run" : "outdoor", workout_name: a.name || (sport === "run" ? "Run" : "Ride"),
        started_at: a.start_date, duration_sec: dur,
        distance_m: dist || null, elevation_m: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
        avg_hr: hr, max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
        avg_power: realPower ? Math.round(a.average_watts) : null, np,
        avg_cadence: sport === "ride" && a.average_cadence ? Math.round(a.average_cadence) : null,
        tss: dur > 0 ? Math.round(dur / 3600 * IF * IF * 100) : null, intensity_factor: Math.round(IF * 100) / 100,
        completed: true, samples: [],
      };
    }).filter((r) => r.duration_sec > 0);
    if (!rows.length) { await saveSince(); return json({ imported: [] }); }

    const { error } = await admin.from("completed_rides").insert(rows);
    if (error) throw error;
    await saveSince();
    return json({ imported: rows });
  } catch (err) {
    console.error("strava-import error:", err);
    return json({ error: "Couldn't import from Strava right now" }, 500);
  }
});
