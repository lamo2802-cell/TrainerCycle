import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { intensityOf, LTHR_FROM_MAX, lthrFromPower, powerBests, runDetail, tssOf } from "../_shared/activity.ts";

// Imports the signed-in user's recent Strava runs, rides and swims into completed_rides (source = 'strava'),
// so they count in TrainerCycle's training load. Anything that overlaps a session already in
// TrainerCycle is skipped: that's a ride recorded here and uploaded to Strava (or recorded on a
// second device at the same time), so importing it would double count. Rides use power for TSS when
// Strava has real power, otherwise heart rate against the rider's threshold heart rate.
// Needs the activity:read_all scope; connections made before imports were supported only have
// activity:write and get { needsReconnect: true }.
// POST {} -> { imported: [rows], needsReconnect?: true }
// POST { detail: id } -> { detail } for one imported run: its 1 km splits, laps and a 5-second pace,
// heart rate and gradient trace, saved to completed_rides.run_detail so it's only fetched once.

const CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") ?? "";
const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const SWIM_TYPES = new Set(["Swim"]);
const RIDE_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
// Strava's best efforts within a run, by name -> metres. Stored as completed_rides.run_bests.
const RUN_EFFORTS: Record<string, number> = { "400m": 400, "1/2 mile": 805, "1K": 1000, "1 mile": 1609, "2 mile": 3219, "5K": 5000, "10K": 10000, "15K": 15000, "10 mile": 16093, "20K": 20000, "Half-Marathon": 21097, "30K": 30000, "Marathon": 42195 };
const DETAIL_CALLS = 25;      // extra Strava requests per sync (power streams, run best efforts), well inside rate limits
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
      admin.from("settings").select("key,value").eq("user_id", user.id).in("key", ["run_threshold_pace", "swim_css", "ftp", "threshold_hr", SINCE_KEY, IGNORED_KEY]),
    ]);
    const setting = (k: string) => (settingRows ?? []).find((r: { key: string }) => r.key === k)?.value?.v;
    if (!conn) return json({ error: "Strava not connected" }, 400);
    // Same rule as saving a ride: only active, trialing or owner accounts add history.
    if (!sub || !["active", "trialing", "owner"].includes(sub.status)) return json({ imported: [] });
    const scope: string = conn.scope ?? "";
    if (!scope.split(",").some((s) => s === "activity:read_all" || s === "activity:read")) return json({ imported: [], needsReconnect: true });

    const fresh = await refreshTokenIfNeeded(admin, user.id, conn);

    const body = await req.json().catch(() => ({}));
    if (body && typeof body.detail === "string") {
      const { data: row } = await admin.from("completed_rides").select("id,external_id,sport,run_detail")
        .eq("user_id", user.id).eq("id", body.detail).eq("source", "strava").maybeSingle();
      if (!row || row.sport !== "run") return json({ error: "Not an imported run" }, 404);
      // v1 (before cadence, altitude and grade-adjusted pace) is fetched once more.
      if (row.run_detail && row.run_detail.v >= 2) return json({ detail: row.run_detail });
      const sid = String(row.external_id).replace("strava:", "");
      const auth = { headers: { Authorization: `Bearer ${fresh.access_token}` } };
      const [dResp, sResp] = await Promise.all([
        fetch(`https://www.strava.com/api/v3/activities/${sid}`, auth),
        fetch(`https://www.strava.com/api/v3/activities/${sid}/streams?keys=time,distance,heartrate,grade_smooth,cadence,altitude&key_by_type=true`, auth),
      ]);
      if (dResp.status === 401 || dResp.status === 403) return json({ detail: null, needsReconnect: true });
      // Gone from Strava: remember there's nothing to show rather than asking again every time.
      const detail = dResp.status === 404 ? { v: 2, splits: [], laps: [], s: null }
        : dResp.ok ? runDetail(await dResp.json(), sResp.ok ? await sResp.json() : null) : null;
      if (!detail) return json({ detail: null }, 502);
      await admin.from("completed_rides").update({ run_detail: detail }).eq("id", row.id);
      return json({ detail });
    }

    // Extra lookups for the power curve of a ride or the best times within a run.
    // An empty {} means "looked, nothing there", so older imports aren't fetched again.
    let calls = 0;
    // deno-lint-ignore no-explicit-any
    const fetchBests = async (r: any) => {
      const sid = String(r.external_id).replace("strava:", "");
      const auth = { headers: { Authorization: `Bearer ${fresh.access_token}` } };
      calls++;
      if (r.sport === "ride") {
        const resp = await fetch(`https://www.strava.com/api/v3/activities/${sid}/streams?keys=time,watts&key_by_type=true`, auth);
        if (!resp.ok) return null;
        const st = await resp.json();
        return { power_bests: (st?.time?.data && st?.watts?.data && powerBests(st.time.data, st.watts.data)) || {} };
      }
      const resp = await fetch(`https://www.strava.com/api/v3/activities/${sid}`, auth);
      if (!resp.ok) return null;
      const d = await resp.json();
      const bests: Record<string, number> = {};
      for (const e of d.best_efforts ?? []) { const m = RUN_EFFORTS[e.name]; if (m && e.elapsed_time > 0) bests[m] = Math.round(e.elapsed_time); }
      return { run_bests: bests, route_polyline: d.map?.summary_polyline ?? "" };
    };
    // The route of an activity imported before routes were stored ("" = looked, no route).
    // deno-lint-ignore no-explicit-any
    const fetchRoute = async (r: any) => {
      const sid = String(r.external_id).replace("strava:", "");
      calls++;
      const resp = await fetch(`https://www.strava.com/api/v3/activities/${sid}`, { headers: { Authorization: `Bearer ${fresh.access_token}` } });
      if (!resp.ok) return null;
      const d = await resp.json();
      return { route_polyline: d.map?.summary_polyline ?? "" };
    };
    // Earlier imports from before bests or routes were fetched: fill them in with whatever calls are left.
    const backfill = async () => {
      if (calls >= DETAIL_CALLS) return;
      const { data: old } = await admin.from("completed_rides").select("id,external_id,sport,np,power_bests,run_bests,route_polyline")
        .eq("user_id", user.id).eq("source", "strava").order("started_at", { ascending: false }).limit(200);
      type Old = { sport: string; np: number | null; power_bests: unknown; run_bests: unknown; route_polyline: string | null };
      const needsBests = (r: Old) => r.sport === "run" ? r.run_bests == null : r.sport === "ride" && !!r.np && r.power_bests == null;
      for (const r of (old ?? []).filter((r: Old) => needsBests(r) || ((r.sport === "ride" || r.sport === "run") && r.route_polyline == null))) {
        if (calls >= DETAIL_CALLS) break;
        try {
          const patch: Record<string, unknown> = needsBests(r) ? (await fetchBests(r)) ?? {} : {};
          if (r.route_polyline == null && patch.route_polyline === undefined && calls < DETAIL_CALLS) Object.assign(patch, (await fetchRoute(r)) ?? {});
          if (Object.keys(patch).length) await admin.from("completed_rides").update(patch).eq("id", r.id);
        } catch (_) { /* try again next sync */ }
      }
    };

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
      return RUN_TYPES.has(t) ? "run" : RIDE_TYPES.has(t) ? "ride" : SWIM_TYPES.has(t) ? "swim" : null;
    };
    const wanted = activities.filter((a) => sportOf(a) && (a.moving_time || a.elapsed_time));
    const saveSince = () => admin.from("settings").upsert({ user_id: user.id, key: SINCE_KEY, value: { v: startedSync }, updated_at: startedSync }, { onConflict: "user_id,key" });
    if (!wanted.length) { await backfill(); await saveSince(); return json({ imported: [] }); }

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
        // Runs and swims logged by hand only have a rough start time: same sport, same day, similar length.
        return (sport === "run" || sport === "swim") && r.sport === sport && Math.abs(r0 - s0) < 14 * 3600000
          && Math.abs((r.duration_sec || 0) - (a.moving_time || a.elapsed_time)) <= 0.3 * (a.moving_time || a.elapsed_time);
      });
    };

    const pace = Number(setting("run_threshold_pace")) || null;
    const css = Number(setting("swim_css")) || null; // seconds per 100 m
    const ftp = Number(setting("ftp")) || null;
    // Threshold heart rate: the rider's own setting, else estimated from the highest heart rate we've seen.
    // Threshold heart rate: the rider's own setting, else from rides with power and heart rate,
    // else estimated from the highest heart rate we've seen.
    let lthr = Number(setting("threshold_hr")) || null;
    if (!lthr) {
      const { data: hrRows } = await admin.from("completed_rides").select("avg_hr,max_hr,np,intensity_factor,duration_sec,sport")
        .eq("user_id", user.id).gte("started_at", new Date(Date.now() - 365 * 86400000).toISOString());
      const rideRows = (hrRows ?? []).filter((r: { sport: string }) => r.sport === "ride");
      lthr = lthrFromPower(rideRows.concat(wanted.filter((a) => sportOf(a) === "ride" && a.device_watts && ftp)
        .map((a) => ({ avg_hr: a.average_heartrate, np: a.weighted_average_watts, intensity_factor: (a.weighted_average_watts || 0) / ftp!, duration_sec: a.moving_time }))));
      if (!lthr) {
        const maxSeen = Math.max(0, ...(hrRows ?? []).map((r: { max_hr: number }) => Number(r.max_hr) || 0), ...wanted.map((a) => Number(a.max_heartrate) || 0));
        if (maxSeen >= 150) lthr = Math.round(maxSeen * LTHR_FROM_MAX);
      }
    }

    const rows = wanted.filter((a) => !have.has("strava:" + a.id) && !duplicate(a, sportOf(a)!)).map((a) => {
      const sport = sportOf(a)!;
      const dur = Math.round(a.moving_time || a.elapsed_time || 0);
      const dist = Math.round(a.distance || 0);
      const hr = a.average_heartrate ? Math.round(a.average_heartrate) : null;
      // Strava estimates power for rides without a meter; only trust it when it came from a device.
      const realPower = sport === "ride" && a.device_watts && a.average_watts;
      const np = realPower ? Math.round(a.weighted_average_watts || a.average_watts) : null;
      const IF = intensityOf(sport, dur, dist, np, hr, { pace, css, ftp, lthr });
      return {
        id: "strava_" + a.id, user_id: user.id, sport, source: "strava", external_id: "strava:" + a.id,
        category: sport === "run" ? "run" : sport === "swim" ? (a.start_latlng && a.start_latlng.length ? "open_water" : "pool") : "outdoor",
        workout_name: a.name || (sport === "run" ? "Run" : sport === "swim" ? "Swim" : "Ride"),
        started_at: a.start_date, duration_sec: dur,
        distance_m: dist || null, elevation_m: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
        avg_hr: hr, max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
        avg_power: realPower ? Math.round(a.average_watts) : null, np,
        avg_cadence: sport === "ride" && a.average_cadence ? Math.round(a.average_cadence) : null,
        tss: tssOf(sport, dur, IF), intensity_factor: Math.round(IF * 100) / 100,
        completed: true, samples: [], power_bests: null, run_bests: null,
        route_polyline: sport === "swim" ? null : (a.map?.summary_polyline ?? ""),
      };
    }).filter((r) => r.duration_sec > 0);
    if (!rows.length) { await backfill(); await saveSince(); return json({ imported: [] }); }

    // Power curve for rides with a power meter, and best times within runs, newest first.
    const needsBests = (r: { sport: string; np: number | null }) => r.sport === "run" || !!r.np;
    for (const r of rows.slice().sort((a, b) => (a.started_at < b.started_at ? 1 : -1))) {
      if (calls >= DETAIL_CALLS) break;
      if (!needsBests(r)) continue;
      try { Object.assign(r, await fetchBests(r)); } catch (_) { /* bests are a bonus; the activity still counts */ }
    }

    const { error } = await admin.from("completed_rides").insert(rows);
    if (error) throw error;
    await backfill();
    await saveSince();
    return json({ imported: rows });
  } catch (err) {
    console.error("strava-import error:", err);
    return json({ error: "Couldn't import from Strava right now" }, 500);
  }
});
