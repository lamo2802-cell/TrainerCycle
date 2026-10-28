import { Decoder, Stream } from "npm:@garmin/fitsdk@21.218.0";
import { powerBests, runDetail } from "../_shared/activity.ts";

// Turns a Garmin FIT file into what strava-import gets from Strava's API: totals, the power curve,
// best times within a run, the route and (for runs) splits, laps and a 5-second trace. The streams
// are shaped like Strava's so runDetail and powerBests work on them unchanged.

const SEMI = 180 / 2 ** 31;              // FIT positions are in semicircles
const MOVING = 0.5;                      // m/s: slower than this counts as stopped for split times
const ROUTE_POINTS = 400;                // about as detailed as Strava's summary polyline
export const RUN_DISTANCES = [400, 805, 1000, 1609, 3219, 5000, 10000, 15000, 16093, 20000, 21097, 30000, 42195]; // as strava-import

export type Parsed = {
  sport: "ride" | "run" | "swim" | null; subSport: string; start: string;
  moving: number; elapsed: number; distance: number; ascent: number | null;
  avgHr: number | null; maxHr: number | null; avgPower: number | null; np: number | null; avgCadence: number | null;
  hasGps: boolean; poolSwim: boolean;
  power_bests: Record<string, number> | null; run_bests: Record<string, number> | null;
  route_polyline: string | null; run_detail: unknown;
};

const num = (x: unknown) => (x == null || !isFinite(Number(x)) ? null : Number(x));
const round = (x: unknown) => { const n = num(x); return n == null ? null : Math.round(n); };

// Google's encoded polyline (precision 5), as route-map.js decodes it.
export function encodePolyline(pts: [number, number][]) {
  let out = "", pLat = 0, pLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) { out += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; }
    out += String.fromCharCode(x + 63);
  };
  for (const [lat, lng] of pts) {
    const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5);
    enc(a - pLat); enc(b - pLng); pLat = a; pLng = b;
  }
  return out;
}

// Fastest time over each distance within a run, from distance at every second. Like Strava's best
// efforts it uses elapsed time, so a pause in the middle counts against the effort.
export function runBests(at: Float64Array) {
  const out: Record<string, number> = {};
  const total = at[at.length - 1] - at[0];
  for (const d of RUN_DISTANCES) {
    if (d > total) break;
    let best = Infinity, i = 0;
    for (let j = 1; j < at.length; j++) {
      if (at[j] - at[i] < d) continue;
      while (i + 1 < j && at[j] - at[i + 1] >= d) i++;
      if (j - i < best) best = j - i;
    }
    if (isFinite(best)) out[d] = best;
  }
  return out;
}

// Distance at every whole second from (time, distance) samples, straight line between samples.
function perSecond(time: number[], vals: number[], end: number) {
  const at = new Float64Array(end + 1);
  for (let i = 1; i < time.length; i++) {
    const t0 = Math.floor(time[i - 1]), t1 = Math.floor(time[i]), v0 = vals[i - 1], v1 = vals[i];
    for (let t = t0; t <= t1 && t <= end; t++) at[t] = t1 > t0 ? v0 + (v1 - v0) * (t - t0) / (t1 - t0) : v1;
  }
  return at;
}

// 1 km splits in Strava's splits_metric shape (moving time, average heart rate, elevation change).
function metricSplits(at: Float64Array, hrAt: (number | null)[], altAt: Float64Array | null) {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  let from = 0, moving = 0, hs = 0, hk = 0, next = 1000;
  const close = (t: number) => {
    out.push({ distance: at[t] - at[from], moving_time: moving, elapsed_time: t - from,
      average_heartrate: hk ? hs / hk : null, elevation_difference: altAt ? altAt[t] - altAt[from] : null });
    from = t; moving = 0; hs = 0; hk = 0;
  };
  for (let t = 1; t < at.length; t++) {
    if (at[t] - at[t - 1] >= MOVING) moving++;
    const h = hrAt[t]; if (h) { hs += h; hk++; }
    if (at[t] >= next) { close(t); next += 1000; }
  }
  if (at.length - 1 > from && at[at.length - 1] - at[from] >= 50) close(at.length - 1);
  return out;
}

export function parseFit(bytes: Uint8Array): Parsed | null {
  const stream = Stream.fromByteArray(bytes);
  if (!Decoder.isFIT(stream)) return null;
  const { messages } = new Decoder(stream).read({ includeUnknownData: false, decodeMemoGlobs: false });
  // deno-lint-ignore no-explicit-any
  const session: any = messages.sessionMesgs?.[0];
  if (!session) return null;
  const sportName = String(session.sport ?? "");
  const sport = sportName === "cycling" ? "ride" : sportName === "running" ? "run" : sportName === "swimming" ? "swim" : null;
  // deno-lint-ignore no-explicit-any
  const start = new Date((session.startTime ?? messages.recordMesgs?.[0]?.timestamp ?? NaN) as any);
  if (isNaN(start.getTime())) return null;
  const t0 = start.getTime();

  // deno-lint-ignore no-explicit-any
  const recs: any[] = (messages.recordMesgs ?? []).filter((r: any) => r.timestamp);
  const time: number[] = [], dist: number[] = [], watts: number[] = [], hr: (number | null)[] = [], cad: (number | null)[] = [], alt: (number | null)[] = [];
  const pts: [number, number][] = [];
  let hasPower = false;
  for (const r of recs) {
    const t = (new Date(r.timestamp).getTime() - t0) / 1000;
    if (t < 0) continue;
    time.push(t);
    dist.push(num(r.distance) ?? (dist.length ? dist[dist.length - 1] : 0));
    const p = num(r.power); if (p != null) hasPower = true;
    watts.push(p ?? 0);
    hr.push(num(r.heartRate));
    cad.push(num(r.cadence));
    alt.push(num(r.enhancedAltitude ?? r.altitude));
    if (r.positionLat != null && r.positionLong != null) pts.push([r.positionLat * SEMI, r.positionLong * SEMI]);
  }

  const out: Parsed = {
    sport, subSport: String(session.subSport ?? ""), start: start.toISOString(),
    moving: Math.round(num(session.totalTimerTime) ?? num(session.totalElapsedTime) ?? 0),
    elapsed: Math.round(num(session.totalElapsedTime) ?? num(session.totalTimerTime) ?? 0),
    distance: Math.round(num(session.totalDistance) ?? 0), ascent: round(session.totalAscent),
    avgHr: round(session.avgHeartRate), maxHr: round(session.maxHeartRate),
    avgPower: hasPower ? round(session.avgPower) : null, np: hasPower ? round(session.normalizedPower ?? session.avgPower) : null,
    avgCadence: sport === "ride" ? round(session.avgCadence) : null,
    hasGps: pts.length > 10, poolSwim: String(session.subSport ?? "") === "lapSwimming",
    power_bests: null, run_bests: null, route_polyline: null, run_detail: null,
  };

  if (sport === "ride" && hasPower && time.length > 5) out.power_bests = powerBests(time, watts) ?? {};
  if (sport !== "swim") {
    const step = Math.max(1, Math.ceil(pts.length / ROUTE_POINTS));
    out.route_polyline = pts.length > 10 ? encodePolyline(pts.filter((_, i) => i % step === 0 || i === pts.length - 1)) : "";
  }
  if (sport === "run") {
    const end = Math.floor(time[time.length - 1] ?? 0);
    if (end > 60 && dist[dist.length - 1] > 100) {
      const at = perSecond(time, dist, end);
      out.run_bests = runBests(at);
      const first = alt.find((a) => a != null);
      let last = first ?? 0;
      const altAt = first != null ? perSecond(time, alt.map((a) => (last = a ?? last)), end) : null;
      const hrAt: (number | null)[] = new Array(end + 1).fill(null);
      for (let i = 0; i < time.length; i++) { const t = Math.floor(time[i]); if (t <= end && hr[i]) hrAt[t] = hr[i]; }
      // Gradient in % over ±5 s, like Strava's grade_smooth.
      const grade = time.map((t) => {
        if (!altAt) return null;
        const a = Math.max(0, Math.floor(t) - 5), b = Math.min(end, Math.floor(t) + 5), dd = at[b] - at[a];
        return dd > 5 ? Math.max(-40, Math.min(40, (altAt[b] - altAt[a]) / dd * 100)) : 0;
      });
      // deno-lint-ignore no-explicit-any
      const laps = (messages.lapMesgs ?? []).map((l: any) => ({
        distance: num(l.totalDistance) ?? 0, moving_time: num(l.totalTimerTime), elapsed_time: num(l.totalElapsedTime),
        average_heartrate: num(l.avgHeartRate), max_heartrate: num(l.maxHeartRate),
      }));
      const fitCad = num(session.avgRunningCadence ?? session.avgCadence);
      out.run_detail = runDetail(
        { splits_metric: metricSplits(at, hrAt, altAt), laps: laps.length > 1 ? laps : [], average_cadence: fitCad },
        { time: { data: time }, distance: { data: dist }, heartrate: { data: hr }, grade_smooth: { data: grade }, cadence: { data: cad }, altitude: { data: alt } },
      );
    } else out.run_bests = {};
  }
  return out;
}
