// Shared by strava-import: power curve, run splits/trace and threshold heart rate,
// so activities from either source get the same records and analysis.

export const BEST_DURS = [5, 60, 180, 300, 480, 720, 1200, 1800, 3600]; // same as ftp-estimate.js
export const REST_HR = 60;           // assumed resting heart rate for the power-based threshold estimate
export const LTHR_FROM_MAX = 0.87;   // rough cycling threshold heart rate from the highest heart rate seen
const FEEL_DEFAULT_IF = 0.76; // no pace to go on: treat as a steady run
const RIDE_DEFAULT_IF = 0.7;  // no power or heart rate: treat as an endurance ride
const SWIM_DEFAULT_IF = 0.78; // no CSS to go on: treat as a steady swim
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type Thresholds = { pace: number | null; css: number | null; ftp: number | null; lthr: number | null };
// Intensity factor of an imported activity: threshold pace for runs, CSS for swims, power then heart
// rate for rides, and a steady default when there's nothing to go on.
export function intensityOf(sport: string, dur: number, dist: number, np: number | null, hr: number | null, t: Thresholds) {
  if (sport === "run" && t.pace && dur > 0 && dist > 0) return clamp(t.pace / (dur / (dist / 1000)), 0.4, 1.15);
  if (sport === "swim" && t.css && dur > 0 && dist > 0) return clamp(t.css / (dur / (dist / 100)), 0.4, 1.15);
  if (np && t.ftp) return clamp(np / t.ftp, 0.3, 1.3);
  if (sport === "ride" && hr && t.lthr) return clamp(hr / t.lthr, 0.45, 1.1);
  return sport === "run" ? FEEL_DEFAULT_IF : sport === "swim" ? SWIM_DEFAULT_IF : RIDE_DEFAULT_IF;
}
// swim TSS uses IF cubed (see swim.js)
export const tssOf = (sport: string, dur: number, IF: number) => dur > 0 ? Math.round(dur / 3600 * Math.pow(IF, sport === "swim" ? 3 : 2) * 100) : null;

// Best average power over BEST_DURS from Strava's time + watts streams. Seconds with no reading
// (stopped, paused) count as zero, so a coffee stop never stretches an effort.
export function powerBests(time: number[], watts: number[]) {
  const n = Math.floor(time[time.length - 1] ?? 0) + 1;
  if (n < 5 || time.length !== watts.length) return null;
  const per = new Float64Array(n);
  for (let i = 0; i < time.length; i++) { const t = Math.floor(time[i]); if (t >= 0 && t < n) per[t] = Math.max(0, Number(watts[i]) || 0); }
  const pre = new Float64Array(n + 1);
  for (let t = 0; t < n; t++) pre[t + 1] = pre[t] + per[t];
  const out: Record<string, number> = {};
  for (const d of BEST_DURS) {
    if (d > n) break;
    let best = 0;
    for (let i = d; i <= n; i++) { const a = (pre[i] - pre[i - d]) / d; if (a > best) best = a; }
    if (best > 0) out[d] = Math.round(best);
  }
  return Object.keys(out).length ? out : null;
}

// A run's splits, laps and trace from Strava's activity and its streams (see 2026-10-28-run-detail.sql;
// v2 adds grade-adjusted pace per split, cadence and altitude).
export const TRACE_DT = 5;                // seconds per trace point
const TRACE_MAX = 6 * 3600;        // longer than this and the trace is left out
// deno-lint-ignore no-explicit-any
export function runDetail(d: any, st: any) {
  const r1 = (x: unknown) => (x == null || !isFinite(Number(x)) ? null : Math.round(Number(x)));
  // deno-lint-ignore no-explicit-any
  const splits = (d.splits_metric ?? []).filter((x: any) => x.distance > 0).map((x: any) => ({
    d: Math.round(x.distance), t: Math.round(x.moving_time || x.elapsed_time || 0), hr: r1(x.average_heartrate), el: r1(x.elevation_difference),
    // Strava's grade-adjusted speed for the split, in cm/s.
    gap: x.average_grade_adjusted_speed ? Math.round(x.average_grade_adjusted_speed * 100) : null,
  }));
  // deno-lint-ignore no-explicit-any
  const laps = (d.laps ?? []).map((x: any) => ({
    d: Math.round(x.distance || 0), t: Math.round(x.moving_time || x.elapsed_time || 0), e: Math.round(x.elapsed_time || x.moving_time || 0),
    hr: r1(x.average_heartrate), mx: r1(x.max_heartrate),
  }));
  let s = null;
  const time: number[] = st?.time?.data ?? [], dist: number[] = st?.distance?.data ?? [];
  const end = Math.floor(time[time.length - 1] ?? 0);
  if (time.length > 10 && dist.length === time.length && end > 60 && end <= TRACE_MAX) {
    // Distance at every second (straight line between samples, so a paused watch reads as standing still).
    const at = new Float64Array(end + 1);
    for (let i = 1; i < time.length; i++) {
      const t0 = Math.floor(time[i - 1]), t1 = Math.floor(time[i]), d0 = dist[i - 1], d1 = dist[i];
      for (let t = t0; t <= t1 && t <= end; t++) at[t] = t1 > t0 ? d0 + (d1 - d0) * (t - t0) / (t1 - t0) : d1;
    }
    const n = Math.floor(end / TRACE_DT);
    const v: number[] = [], h: (number | null)[] = [], g: (number | null)[] = [], c: (number | null)[] = [], a: (number | null)[] = [];
    // One pass to find each bucket's samples instead of scanning the whole stream per bucket.
    let j = 0;
    for (let b = 0; b < n; b++) {
      v.push(Math.max(0, Math.round((at[(b + 1) * TRACE_DT] - at[b * TRACE_DT]) / TRACE_DT * 100)));
      let hs = 0, hk = 0, gs = 0, gk = 0, cs = 0, ck = 0, als = 0, alk = 0;
      while (j < time.length && time[j] < (b + 1) * TRACE_DT) {
        const hv = st?.heartrate?.data?.[j], gv = st?.grade_smooth?.data?.[j], cv = st?.cadence?.data?.[j], av = st?.altitude?.data?.[j];
        if (hv != null) { hs += hv; hk++; }
        if (gv != null) { gs += gv; gk++; }
        if (cv) { cs += cv; ck++; }   // 0 while stopped, which would drag the average down
        if (av != null) { als += av; alk++; }
        j++;
      }
      h.push(hk ? Math.round(hs / hk) : null);
      g.push(gk ? Math.round(gs / gk * 10) / 10 : null);
      c.push(ck ? Math.round(cs / ck * 2) : null);   // Strava counts one foot, so x2 for steps per minute
      a.push(alk ? Math.round(als / alk * 10) / 10 : null);
    }
    const some = (x: (number | null)[]) => x.some((y) => y != null) ? x : null;
    s = { dt: TRACE_DT, v, h: some(h), g: some(g), c: some(c), a: some(a) };
  }
  return { v: 2, splits, laps, s, cad: d.average_cadence ? Math.round(d.average_cadence * 2) : null };
}

// Threshold heart rate from rides with both power and heart rate (power first): heart rate rises
// roughly in line with intensity, so a ride at IF x with average heart rate h puts threshold near
// rest + (h - rest) / x. Uses steady-to-hard rides of 20 minutes or more and takes the median.
// deno-lint-ignore no-explicit-any
export function lthrFromPower(rows: any[]) {
  const est = rows.filter((r) => r.avg_hr && r.np && r.intensity_factor >= 0.75 && r.intensity_factor <= 1.05 && r.duration_sec >= 1200)
    .map((r) => REST_HR + (r.avg_hr - REST_HR) / r.intensity_factor).sort((a, b) => a - b);
  if (est.length < 2) return null;
  return Math.round(est[Math.floor(est.length / 2)]);
}

