import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Imports the signed-in user's recent Strava runs into completed_rides (sport = 'run', source = 'strava'),
// so they count in TrainerCycle's training load. Rides aren't imported: those are recorded here and
// uploaded to Strava, so importing them back would double count. Needs the activity:read_all scope;
// connections made before runs were supported only have activity:write and get { needsReconnect: true }.
// POST {} -> { imported: [rows], needsReconnect?: true }

const CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") ?? "";
const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const FEEL_DEFAULT_IF = 0.76; // no pace to go on: treat as a steady run

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
    const [{ data: conn }, { data: sub }, { data: paceRow }] = await Promise.all([
      admin.from("strava_connections").select("*").eq("user_id", user.id).maybeSingle(),
      admin.from("subscriptions").select("status").eq("user_id", user.id).maybeSingle(),
      admin.from("settings").select("value").eq("user_id", user.id).eq("key", "run_threshold_pace").maybeSingle(),
    ]);
    if (!conn) return json({ error: "Strava not connected" }, 400);
    // Same rule as saving a ride: only active, trialing or owner accounts add history.
    if (!sub || !["active", "trialing", "owner"].includes(sub.status)) return json({ imported: [] });
    const scope: string = conn.scope ?? "";
    if (!scope.split(",").some((s) => s === "activity:read_all" || s === "activity:read")) return json({ imported: [], needsReconnect: true });

    const fresh = await refreshTokenIfNeeded(admin, user.id, conn);

    // Only look back as far as the newest run already imported (or 60 days on the first sync).
    const { data: lastRow } = await admin.from("completed_rides").select("started_at")
      .eq("user_id", user.id).eq("source", "strava").order("started_at", { ascending: false }).limit(1).maybeSingle();
    const since = lastRow ? new Date(lastRow.started_at).getTime() - 86400000 : Date.now() - 60 * 86400000;
    const after = Math.floor(since / 1000);

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
    const runs = activities.filter((a) => RUN_TYPES.has(a.sport_type ?? a.type));
    if (!runs.length) return json({ imported: [] });

    const ids = runs.map((a) => "strava:" + a.id);
    const { data: existing } = await admin.from("completed_rides").select("external_id").eq("user_id", user.id).in("external_id", ids);
    const have = new Set((existing ?? []).map((r: { external_id: string }) => r.external_id));
    const pace = Number(paceRow?.value?.v) || null;

    const rows = runs.filter((a) => !have.has("strava:" + a.id)).map((a) => {
      const dur = Math.round(a.moving_time || a.elapsed_time || 0);
      const dist = Math.round(a.distance || 0);
      let IF = FEEL_DEFAULT_IF;
      if (pace && dur > 0 && dist > 0) IF = Math.max(0.4, Math.min(1.15, pace / (dur / (dist / 1000))));
      return {
        id: "strava_" + a.id, user_id: user.id, sport: "run", source: "strava", external_id: "strava:" + a.id,
        category: "run", workout_name: a.name || "Run", started_at: a.start_date, duration_sec: dur,
        distance_m: dist || null, elevation_m: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
        avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null, max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
        tss: dur > 0 ? Math.round(dur / 3600 * IF * IF * 100) : null, intensity_factor: Math.round(IF * 100) / 100,
        completed: true, samples: [],
      };
    }).filter((r) => r.duration_sec > 0);
    if (!rows.length) return json({ imported: [] });

    const { error } = await admin.from("completed_rides").insert(rows);
    if (error) throw error;
    return json({ imported: rows });
  } catch (err) {
    console.error("strava-import error:", err);
    return json({ error: "Couldn't import from Strava right now" }, 500);
  }
});
