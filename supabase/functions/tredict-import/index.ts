import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { intensityOf, LTHR_FROM_MAX, lthrFromPower, tssOf } from "../_shared/activity.ts";
import { parseFit, type Parsed } from "./fit.ts";

// Imports the signed-in user's Garmin history from Tredict into completed_rides (source = 'garmin'),
// with the same records and run analysis as Strava imports. Tredict only gives raw FIT files to a
// Personal API token (Tredict Settings -> Personal API, scope activityRead), which the rider pastes in
// Settings; its OAuth login isn't offered to apps that only read activities.
// Anything that overlaps an activity already in TrainerCycle, from any source, is skipped, and
// strava-import skips anything overlapping these rows, so nothing is counted twice.
// The import runs in batches to stay inside the edge function's CPU limit; the page calls again
// until nothing is left.
// POST { token } -> { ok, total } checks and saves the token (or { error } when Tredict refuses it)
// POST { forget: true } -> { ok } removes the saved token
// POST {} -> { imported, remaining, skipped }

const API = "https://www.tredict.com/api/oauth/v2/";
const TOKEN_KEY = "tredict_token";
const IGNORED_KEY = "strava_import_ignored"; // deleted imports from either source, so they don't come back
const SPORTS: Record<string, "ride" | "run" | "swim"> = { cycling: "ride", running: "run", swimming: "swim" };
const CPU_BUDGET = 1100;   // ms of parsing per call, well inside the 2 s CPU limit
const MAX_PER_CALL = 25;
const SLACK = 5 * 60000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class TokenError extends Error {}

// deno-lint-ignore no-explicit-any
async function tredict(token: string, path: string): Promise<any> {
  const url = path.startsWith("http") ? path : API + path.replace(/^\/?(api\/oauth\/v2\/)?/, "");
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (resp.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (resp.status === 401 || resp.status === 403) throw new TokenError(String(resp.status));
    if (!resp.ok) throw new Error(`Tredict ${path} failed: ${resp.status}`);
    return resp;
  }
}

// Every executed activity, newest first, with its summary (duration, distance, heart rate, title).
// deno-lint-ignore no-explicit-any
async function activityList(token: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const all: any[] = [];
  let next: string | null = "activityList?pageSize=1000&extendedSummary=1";
  for (let page = 0; next && page < 20; page++) {
    // deno-lint-ignore no-explicit-any
    const body: any = await (await tredict(token, next)).json();
    // deno-lint-ignore no-explicit-any
    const list: any[] = body?._embedded?.activityList ?? [];
    all.push(...list);
    const href: string | null = body?._links?.next?.href ?? null;
    next = list.length && href && href !== next ? href : null;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const body = await req.json().catch(() => ({}));
    const saveSetting = (key: string, v: unknown) =>
      admin.from("settings").upsert({ user_id: user.id, key, value: { v }, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });

    if (body?.forget) {
      await admin.from("settings").delete().eq("user_id", user.id).eq("key", TOKEN_KEY);
      return json({ ok: true });
    }
    if (typeof body?.token === "string") {
      const token = body.token.trim();
      if (!/^[\w.\-~+/=]{10,4096}$/.test(token)) return json({ error: "That doesn't look like a Tredict token." });
      try {
        const list = await activityList(token);
        await saveSetting(TOKEN_KEY, token);
        return json({ ok: true, total: list.filter((a) => SPORTS[a.sportType]).length });
      } catch (e) {
        if (e instanceof TokenError) return json({ error: "Tredict didn't accept that token. Check it has activityRead, and that you've opened Tredict in the last 10 days." });
        throw e;
      }
    }

    const [{ data: sub }, { data: settingRows }] = await Promise.all([
      admin.from("subscriptions").select("status").eq("user_id", user.id).maybeSingle(),
      admin.from("settings").select("key,value").eq("user_id", user.id).in("key", ["run_threshold_pace", "swim_css", "ftp", "threshold_hr", TOKEN_KEY, IGNORED_KEY]),
    ]);
    const setting = (k: string) => (settingRows ?? []).find((r: { key: string }) => r.key === k)?.value?.v;
    const token = setting(TOKEN_KEY);
    if (!token) return json({ error: "Add your Tredict token first" }, 400);
    // Same rule as saving a ride: only active, trialing or owner accounts add history.
    if (!sub || !["active", "trialing", "owner"].includes(sub.status)) return json({ imported: 0, remaining: 0, skipped: 0 });

    let list;
    try { list = await activityList(token); } catch (e) {
      if (e instanceof TokenError) return json({ needsToken: true });
      throw e;
    }
    // deno-lint-ignore no-explicit-any
    const wanted = list.filter((a: any) => SPORTS[a.sportType] && a.id && a.date);
    if (!wanted.length) return json({ imported: 0, remaining: 0, skipped: 0 });

    // Everything already here, a page at a time (the API returns at most 1000 rows per request).
    // deno-lint-ignore no-explicit-any
    const existing: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("completed_rides").select("started_at,duration_sec,sport,source,external_id,avg_hr,max_hr,np,intensity_factor")
        .eq("user_id", user.id).order("started_at").range(from, from + 999);
      if (error) throw error;
      existing.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const have = new Set([...existing.map((r: { external_id: string | null }) => r.external_id).filter(Boolean), ...(setting(IGNORED_KEY) ?? [])]);
    // Overlaps anything already here: recorded in TrainerCycle, brought in from Strava or logged by hand.
    const overlaps = (sport: string, s0: number, secs: number) => existing.some((r: { started_at: string; duration_sec: number; sport: string; source: string }) => {
      const r0 = Date.parse(r.started_at), r1 = r0 + (r.duration_sec || 0) * 1000;
      if (s0 < r1 + SLACK && r0 < s0 + secs * 1000 + SLACK) return true;
      // Runs and swims logged by hand only have a rough start time: same sport, same day, similar length.
      return r.source === "manual" && (sport === "run" || sport === "swim") && r.sport === sport && Math.abs(r0 - s0) < 14 * 3600000
        && Math.abs((r.duration_sec || 0) - secs) <= 0.3 * secs;
    });
    // deno-lint-ignore no-explicit-any
    const secsOf = (a: any) => Number(a.summary?.durationTotal || a.summary?.duration) || 0;
    // Oldest first, so the history fills in from the start. Two recordings of the same session (a
    // watch and a bike computer) only bring in the first.
    // deno-lint-ignore no-explicit-any
    wanted.sort((a: any, b: any) => (a.date < b.date ? -1 : 1));
    // deno-lint-ignore no-explicit-any
    const todo: any[] = [];
    for (const a of wanted) {
      const s0 = Date.parse(a.date), secs = secsOf(a);
      if (have.has("tredict:" + a.id) || overlaps(SPORTS[a.sportType], s0, secs)) continue;
      const prev = todo[todo.length - 1];
      if (prev && s0 < Date.parse(prev.date) + secsOf(prev) * 1000 + SLACK) continue;
      todo.push(a);
    }
    const skipped = wanted.length - todo.length;
    if (!todo.length) return json({ imported: 0, remaining: 0, skipped });

    const pace = Number(setting("run_threshold_pace")) || null;
    const css = Number(setting("swim_css")) || null;
    const ftp = Number(setting("ftp")) || null;
    // Threshold heart rate: the rider's own setting, else from rides with power and heart rate,
    // else estimated from the highest heart rate we've seen (as strava-import).
    let lthr = Number(setting("threshold_hr")) || null;
    if (!lthr) {
      lthr = lthrFromPower(existing.filter((r: { sport: string }) => r.sport === "ride"));
      if (!lthr) {
        // deno-lint-ignore no-explicit-any
        const maxSeen = Math.max(0, ...existing.map((r: any) => Number(r.max_hr) || 0), ...wanted.map((a: any) => Number(a.summary?.heartrateMax) || 0));
        if (maxSeen >= 150) lthr = Math.round(maxSeen * LTHR_FROM_MAX);
      }
    }

    // deno-lint-ignore no-explicit-any
    const rows: any[] = [];
    let cpu = 0, done = 0;
    for (const a of todo) {
      if (cpu > CPU_BUDGET || done >= MAX_PER_CALL) break;
      done++;
      const sport = SPORTS[a.sportType];
      let fit: Parsed | null = null;
      try {
        const bytes = new Uint8Array(await (await tredict(token, "activity/file/" + encodeURIComponent(a.id))).arrayBuffer());
        const t = performance.now();
        try { fit = parseFit(bytes); } catch (_) { fit = null; }
        cpu += performance.now() - t;
      } catch (e) {
        if (e instanceof TokenError) return json({ needsToken: true, imported: rows.length });
        // A file Tredict can't hand over (manual entry, uploaded TCX): the summary still counts.
      }
      const sum = a.summary ?? {};
      const dur = fit?.moving || Math.round(Number(sum.duration) || Number(sum.durationTotal) || 0);
      if (!(dur > 0)) { rows.push(null); continue; }
      const dist = fit?.distance || Math.round(Number(sum.distance) || 0);
      const hr = fit?.avgHr ?? (sum.heartrate ? Math.round(sum.heartrate) : null);
      const np = sport === "ride" ? fit?.np ?? null : null;
      const IF = intensityOf(sport, dur, dist, np, hr, { pace, css, ftp, lthr });
      const indoor = sport === "ride" && fit && (!fit.hasGps || /indoor|virtual|spin/i.test(fit.subSport));
      rows.push({
        id: "tredict_" + a.id, user_id: user.id, sport, source: "garmin", external_id: "tredict:" + a.id,
        category: sport === "run" ? "run" : sport === "swim" ? (fit ? (fit.poolSwim ? "pool" : "open_water") : sum.positionLat ? "open_water" : "pool") : indoor ? "indoor" : "outdoor",
        workout_name: a.title || (sport === "run" ? "Run" : sport === "swim" ? "Swim" : "Ride"),
        started_at: fit?.start ?? new Date(a.date).toISOString(), duration_sec: dur,
        distance_m: dist || null, elevation_m: fit?.ascent ?? (sum.altitude?.ascent != null ? Math.round(sum.altitude.ascent) : null),
        avg_hr: hr, max_hr: fit?.maxHr ?? (sum.heartrateMax ? Math.round(sum.heartrateMax) : null),
        avg_power: sport === "ride" ? fit?.avgPower ?? null : null, np,
        avg_cadence: fit?.avgCadence ?? null,
        tss: tssOf(sport, dur, IF), intensity_factor: Math.round(IF * 100) / 100,
        completed: true, samples: [],
        power_bests: sport === "ride" ? (fit?.power_bests ?? (np ? {} : null)) : null,
        run_bests: sport === "run" ? fit?.run_bests ?? {} : null,
        route_polyline: sport === "swim" ? null : fit?.route_polyline ?? "",
        run_detail: sport === "run" ? fit?.run_detail ?? null : null,
      });
    }
    const real = rows.filter(Boolean);
    if (real.length) {
      const { error } = await admin.from("completed_rides").upsert(real, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    }
    // Activities with no time at all can't be imported: remember them so they don't hold up the count.
    const empty = todo.slice(0, done).filter((_: unknown, i: number) => !rows[i]).map((a: { id: string }) => "tredict:" + a.id);
    if (empty.length) await saveSetting(IGNORED_KEY, [...(setting(IGNORED_KEY) ?? []), ...empty].slice(-1000));
    return json({ imported: real.length, remaining: todo.length - done, skipped });
  } catch (err) {
    console.error("tredict-import error:", err);
    return json({ error: "Couldn't import from Tredict right now" }, 500);
  }
});
