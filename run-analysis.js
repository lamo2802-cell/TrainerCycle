// Splits, laps and interval workouts for runs imported from Strava (completed_rides.run_detail, filled
// by strava-import { detail: id } the first time a run is opened; shape in 2026-10-28-run-detail.sql).
// A run only gets a workout analysis when the intervals are clear: from the laps when the watch
// recorded them (lap button or a structured workout), otherwise from the pace trace. Anything
// borderline (a hilly easy run, a fartlek with no pattern, a few strides) shows splits only.
// Every run with a trace also gets a pace / heart rate / elevation chart and time in zones.
import { fmtPace, fmtKm, PACE_ZONES } from './run.js?v=9';
import { stackHtml } from './activity-charts.js?v=1';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const sum = a => a.reduce((x, y) => x + y, 0);
const median = a => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cv = a => { if (a.length < 2) return 0; const m = sum(a) / a.length; return m ? Math.sqrt(sum(a.map(x => (x - m) ** 2)) / a.length) / m : 0; };
const STANDING = 0.8; // m/s: slower than this a recovery counts as standing (or walking very slowly)

function fmtTime(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}
const paceOf = (d, t) => d > 0 && t > 0 ? fmtPace(t / (d / 1000)) : '—';

// Best split of sorted values into a slow and a fast group (Otsu): the threshold that makes the two
// groups as far apart as possible relative to their spread.
function splitPoint(vals){
  const s = vals.slice().sort((a, b) => a - b), n = s.length;
  const pre = [0]; s.forEach(v => pre.push(pre[pre.length - 1] + v));
  let best = -1, at = null;
  for (let i = 1; i < n; i++){
    if (s[i] === s[i - 1]) continue;
    const w0 = i / n, w1 = 1 - w0, m0 = pre[i] / i, m1 = (pre[n] - pre[i]) / (n - i);
    const between = w0 * w1 * (m1 - m0) ** 2;
    if (between > best){ best = between; at = (s[i - 1] + s[i]) / 2; }
  }
  return at;
}

// Laps that are all the same length (bar the last) came from auto lap, not from the runner.
function autoLapLength(laps){
  if (laps.length < 3) return null;
  const body = laps.slice(0, -1).map(l => l.d), m = median(body);
  return m >= 300 && body.every(d => Math.abs(d - m) <= m * 0.03) ? m : null;
}

// Turns a fast/slow labelling of consecutive pieces into reps and the recoveries between them,
// then checks the pattern is clear enough to call it a workout.
// pieces: [{ d, t, e, hr, mx, fast }] in order. Returns null or the workout.
function buildWorkout(pieces, { minReps, minRepSec, ratio, gap, speedCv, regular }){
  const groups = [];
  for (const p of pieces){
    const g = groups[groups.length - 1];
    if (g && g.fast === p.fast){ g.items.push(p); continue; }
    groups.push({ fast: p.fast, items: [p] });
  }
  const merge = g => {
    const d = sum(g.items.map(x => x.d)), e = sum(g.items.map(x => x.e)), t = sum(g.items.map(x => x.t));
    const hrT = sum(g.items.filter(x => x.hr).map(x => x.e));
    const hr = hrT ? Math.round(sum(g.items.filter(x => x.hr).map(x => x.hr * x.e)) / hrT) : null;
    const mxs = g.items.map(x => x.mx).filter(Boolean);
    return { d, e, t, hr, mx: mxs.length ? Math.max(...mxs) : null, speed: e ? d / e : 0, start: g.items[0].start, end: g.items[g.items.length - 1].end };
  };
  const firstFast = groups.findIndex(g => g.fast), lastFast = groups.length - 1 - groups.slice().reverse().findIndex(g => g.fast);
  if (firstFast < 0) return null;
  const reps = [], recs = [];
  for (let i = firstFast; i <= lastFast; i++) (groups[i].fast ? reps : recs).push(merge(groups[i]));
  if (reps.length < minReps || reps.length > 40) return null;
  if (reps.some(r => r.e < minRepSec || r.d < 80)) return null;
  if (reps.length === 2 && reps.some(r => r.e < 240)) return null;   // two reps only count when they're long ones
  if (!recs.length) return null;
  // A steady run with a stop or two (traffic lights, a gate) isn't reps: real recoveries take a fair
  // share of the time, even short standing ones.
  if (sum(recs.map(r => r.e)) < 0.15 * sum(reps.map(r => r.e)) && median(recs.map(r => r.speed)) < 1.5) return null;
  const repSp = reps.map(r => r.speed), recSp = recs.map(r => r.speed);
  if (median(repSp) < ratio * median(recSp)) return null;
  // Every rep clearly quicker than the recoveries either side of it.
  for (let i = 0; i < reps.length; i++){
    const near = [recs[i - 1], recs[i]].filter(Boolean);
    if (near.some(r => reps[i].speed < gap * r.speed)) return null;
  }
  if (cv(repSp) > speedCv) return null;
  // From the pace trace alone, the reps also need to be a regular length (by time or distance),
  // which is what sets a session apart from hills or surges on an easy run.
  if (regular && cv(reps.map(r => r.e)) > 0.3 && cv(reps.map(r => r.d)) > 0.3) return null;
  const warm = groups.slice(0, firstFast).map(merge), cool = groups.slice(lastFast + 1).map(merge);
  // Standing recoveries with no slower running either side look just like an easy run stopped at
  // traffic lights, so they need a warm-up or cool-down jog the reps were clearly quicker than.
  if (median(recSp) < STANDING){
    const jogs = warm.concat(cool).filter(x => x.speed >= STANDING && x.e >= 120);
    if (!jogs.length || median(repSp) < 1.15 * Math.max(...jogs.map(x => x.speed))) return null;
  }
  return { reps, recs, warmup: warm[0] || null, cooldown: cool[0] || null };
}

function fromLaps(laps){
  const ls = laps.filter(l => l.e > 0 && l.d >= 0);
  if (ls.length < 4 || autoLapLength(ls)) return null;
  const moving = ls.map(l => l.d / l.e).filter(v => v >= STANDING);   // see fromTrace
  const thr = moving.length >= 2 ? splitPoint(moving) : null;
  if (thr == null) return null;
  let t = 0;
  const pieces = ls.map(l => { const p = { ...l, fast: l.d / l.e >= thr, start: t, end: t + l.e }; t += l.e; return p; });
  return buildWorkout(pieces, { minReps: 2, minRepSec: 20, ratio: 1.2, gap: 1.08, speedCv: 0.15, regular: false });
}

// Grade adjusted: uphill running costs more than its pace shows, downhill a little less.
export const gradeFactor = g => g == null ? 1 : (g = Math.max(-15, Math.min(15, g)), g > 0 ? 1 + 0.033 * g : 1 + 0.018 * g);

function fromTrace(s){
  if (!s || !s.v || s.v.length < 120) return null;   // under 10 minutes
  const dt = s.dt || 5, n = s.v.length;
  const raw = s.v.map((v, i) => v / 100 * gradeFactor(s.g && s.g[i]));
  const sm = raw.map((_, i) => { let a = 0, k = 0; for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < n){ a += raw[j]; k++; } return a / k; });
  // Standing still (traffic lights, standing recoveries) would pull the split down between stopped and
  // moving, so it's set from the moving parts: easy running against the reps.
  const thr = splitPoint(sm.filter(v => v >= STANDING));
  if (thr == null) return null;
  let fast = sm.map(v => v >= thr);
  // Tidy the edges: a 10 s blip doesn't end a rep, and a burst under 30 s isn't one.
  const runs = () => { const out = []; for (let i = 0; i < n;){ let j = i; while (j < n && fast[j] === fast[i]) j++; out.push([i, j, fast[i]]); i = j; } return out; };
  for (const [a, b, f] of runs()) if (!f && a > 0 && b < n && b - a <= 2) for (let i = a; i < b; i++) fast[i] = true;
  for (const [a, b, f] of runs()) if (f && (b - a) * dt < 30) for (let i = a; i < b; i++) fast[i] = false;
  const pieces = runs().map(([a, b, f]) => {
    const hrs = s.h ? s.h.slice(a, b).filter(x => x != null) : [];
    const d = sum(s.v.slice(a, b)) / 100 * dt;
    return { d, t: (b - a) * dt, e: (b - a) * dt, hr: hrs.length ? Math.round(sum(hrs) / hrs.length) : null, mx: hrs.length ? Math.max(...hrs) : null,
      fast: f, start: a * dt, end: b * dt, gap: sum(raw.slice(a, b)) * dt };
  });
  const w = buildWorkout(pieces, { minReps: 2, minRepSec: 30, ratio: 1.25, gap: 1.1, speedCv: 0.12, regular: true });
  if (!w) return null;
  if (sum(w.reps.map(r => r.e)) < 0.1 * n * dt) return null;
  return w;
}

// "6 × 800 m", "5 × 3:00", or "6 reps" when they weren't all the same.
const roundDist = m => m < 400 ? Math.round(m / 50) * 50 : m < 950 ? Math.round(m / 100) * 100 : Math.round(m / 500) * 500;
function niceDist(m){ const r = roundDist(m); return r < 1000 ? r + ' m' : (r / 1000) + ' km'; }
function niceTime(sec){ const step = sec >= 120 ? 15 : 5; return fmtTime(Math.round(sec / step) * step); }
// When reps match on both, go with whichever is the rounder number (800 m rather than 2:58, 20:00 rather than 4.3 km).
function workoutLabel(reps){
  const n = reps.length, d = median(reps.map(r => r.d)), e = median(reps.map(r => r.e));
  const byD = cv(reps.map(r => r.d)) <= 0.08, byE = cv(reps.map(r => r.e)) <= 0.08;
  const offD = Math.abs(roundDist(d) - d) / d;
  const offE = Math.abs(Math.round(e / 60) * 60 - e) / e;
  if (byD && (!byE || offD <= offE)) return n + ' × ' + niceDist(d);
  if (byE) return n + ' × ' + niceTime(e);
  return n + ' reps';
}

export function analyseRun(detail){
  if (!detail) return null;
  const laps = (detail.laps || []).filter(l => l.e > 0);
  const auto = autoLapLength(laps);
  let workout = fromLaps(laps), from = 'laps';
  if (!workout){ workout = fromTrace(detail.s); from = 'trace'; }
  if (workout){ workout.from = from; workout.label = workoutLabel(workout.reps); }
  return {
    splits: (detail.splits || []).filter(x => x.d >= 20 && x.t > 0),
    // Auto laps every kilometre would just repeat the splits.
    laps: laps.length >= 2 && !(auto && Math.abs(auto - 1000) < 30) ? laps : [],
    workout,
  };
}

// ---- rendering ----

function splitsTable(splits){
  const speeds = splits.map(x => x.d / x.t), top = Math.max(...speeds), low = Math.min(...speeds);
  const fastest = splits.length > 2 ? speeds.indexOf(top) : -1;
  const gap = splits.some(x => x.gap);
  let km = 0;
  return '<table class="run-recs ra-splits"><thead><tr><th>Km</th><th>Pace</th>' + (gap ? '<th title="Grade-adjusted pace: the flat-ground pace for the same effort">GAP</th>' : '')
    + '<th class="ra-barcol"></th><th>HR</th><th class="opt">Elev</th></tr></thead><tbody>'
    + splits.map((x, i) => {
      km += x.d;
      const whole = x.d >= 980;
      const w = top > low ? 35 + 65 * (speeds[i] - low) / (top - low) : 100;
      return '<tr' + (i === fastest ? ' class="ra-best"' : '') + '><td class="p">' + (whole ? Math.round(km / 1000) : (x.d / 1000).toFixed(2)) + '</td>'
        + '<td class="t">' + paceOf(x.d, x.t) + '</td>' + (gap ? '<td class="t ra-gap">' + (x.gap ? fmtPace(100000 / x.gap) : '–') + '</td>' : '') + '<td class="ra-barcol"><span class="ra-bar" style="width:' + w.toFixed(0) + '%"></span></td>'
        + '<td class="p">' + (x.hr ?? '–') + '</td><td class="p opt">' + (x.el == null ? '–' : (x.el > 0 ? '+' : '') + x.el + ' m') + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function lapsTable(laps){
  return '<table class="run-recs"><thead><tr><th>Lap</th><th>Distance</th><th>Time</th><th>Pace</th><th>HR</th><th class="opt">Max HR</th></tr></thead><tbody>'
    + laps.map((l, i) => '<tr><td class="p">' + (i + 1) + '</td><td class="p">' + (l.d >= 1000 ? fmtKm(l.d) + ' km' : l.d + ' m') + '</td>'
      + '<td class="t">' + fmtTime(l.e) + '</td><td class="t">' + paceOf(l.d, l.t || l.e) + '</td>'
      + '<td class="p">' + (l.hr ?? '–') + '</td><td class="p opt">' + (l.mx ?? '–') + '</td></tr>').join('')
    + '</tbody></table>';
}

export function splitsPanelHtml(a){
  if (!a || (!a.splits.length && !a.laps.length)) return '';
  const tabs = a.splits.length && a.laps.length
    ? '<div class="seg ra-seg"><button class="on" data-ra-tab="splits">1 km splits</button><button data-ra-tab="laps">Laps (' + a.laps.length + ')</button></div>' : '';
  return '<div class="panel ra-panel"><div class="panel-title"><span>' + (a.splits.length ? 'Splits' : 'Laps') + '</span>' + tabs + '</div>'
    + (a.splits.length ? '<div data-ra-pane="splits">' + splitsTable(a.splits) + '</div>' : '')
    + (a.laps.length ? '<div data-ra-pane="laps"' + (a.splits.length ? ' hidden' : '') + '>' + lapsTable(a.laps) + '</div>' : '')
    + '</div>';
}

// Pace across the run with the reps shaded.
function traceChart(s, w){
  const dt = s.dt || 5, n = s.v.length, total = n * dt;
  const sm = s.v.map((_, i) => { let a = 0, k = 0; for (let j = i - 3; j <= i + 3; j++) if (j >= 0 && j < n){ a += s.v[j]; k++; } return a / k / 100; });
  const sorted = sm.slice().sort((a, b) => a - b);
  const hi = Math.max(sorted[Math.floor(n * 0.995)] * 1.05, 3), lo = Math.max(0, Math.min(sorted[Math.floor(n * 0.05)], hi * 0.45));
  const W = 1000, H = 150, y = v => H - Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * (H - 6) - 3, x = t => t / total * W;
  const pts = sm.map((v, i) => x((i + 0.5) * dt).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const bands = w.reps.map(r => '<rect x="' + x(r.start).toFixed(1) + '" y="0" width="' + Math.max(1, x(r.end) - x(r.start)).toFixed(1) + '" height="' + H + '" class="ra-rep"/>').join('');
  // A line at the reps' average pace to read the chart against.
  const repV = sum(w.reps.map(r => r.d)) / sum(w.reps.map(r => r.e));
  const guides = '<line x1="0" x2="' + W + '" y1="' + y(repV).toFixed(1) + '" y2="' + y(repV).toFixed(1) + '" class="ra-guide"/>';
  return '<div class="ra-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + bands + guides
    + '<polyline points="' + pts + '" class="ra-line" vector-effect="non-scaling-stroke"/></svg>'
    + '<span class="ra-ylab" style="top:' + (y(repV) / H * 100).toFixed(1) + '%">' + fmtPace(1000 / repV) + ' /km</span>'
    + '<div class="ra-xlab"><span>0:00</span><span>' + fmtTime(total) + '</span></div></div>';
}

export function workoutPanelHtml(a, detail){
  const w = a && a.workout;
  if (!w) return '';
  const repD = sum(w.reps.map(r => r.d)), repE = sum(w.reps.map(r => r.e));
  const hrs = w.reps.filter(r => r.hr), repHr = hrs.length ? Math.round(sum(hrs.map(r => r.hr * r.e)) / sum(hrs.map(r => r.e))) : null;
  const recE = median(w.recs.map(r => r.e)), standing = median(w.recs.map(r => r.speed)) < STANDING;
  const recD = sum(w.recs.map(r => r.d)), recT = sum(w.recs.map(r => r.e));
  const paces = w.reps.map(r => r.e / (r.d / 1000));
  const first = paces[0], last = paces[paces.length - 1];
  const drift = (last - first) / first;
  const steadiness = Math.abs(drift) < 0.015 ? 'Even' : Math.round(Math.abs(drift) * 100) + '% ' + (drift < 0 ? 'quicker' : 'slower');
  const stat = (v, l) => '<div class="d-stat"><div class="val">' + v + '</div><div class="lbl">' + l + '</div></div>';
  const rows = w.reps.map((r, i) => {
    const rec = w.recs[i];
    return '<tr><td class="p">' + (i + 1) + '</td><td class="p">' + (r.d >= 1000 ? fmtKm(r.d) + ' km' : Math.round(r.d) + ' m') + '</td>'
      + '<td class="t">' + fmtTime(r.e) + '</td><td class="t">' + fmtPace(r.e / (r.d / 1000)) + '</td><td class="p">' + (r.hr ?? '–') + (r.mx ? '<span class="ra-dim"> / ' + r.mx + '</span>' : '') + '</td>'
      + '<td class="p opt">' + (rec ? fmtTime(rec.e) + (rec.speed < STANDING ? ' standing' : ' at ' + fmtPace(rec.e / (rec.d / 1000))) : '') + '</td></tr>';
  }).join('');
  const bits = [w.warmup && 'Warm-up ' + fmtTime(w.warmup.e), w.cooldown && 'cool-down ' + fmtTime(w.cooldown.e)].filter(Boolean).join(', ');
  const note = [bits && bits.charAt(0).toUpperCase() + bits.slice(1) + '.', w.from === 'trace' && 'Rep edges are read from your pace, so they can be a few seconds out.'].filter(Boolean).join(' ');
  return '<div class="panel ra-panel ra-workout"><div class="panel-title"><span>Workout · ' + esc(w.label) + '</span>'
    + '<span class="ra-src">' + (w.from === 'laps' ? 'From your laps' : 'Spotted in your pace') + '</span></div>'
    + '<div class="d-stats ra-stats">' + stat(fmtPace(repE / (repD / 1000)), 'Rep pace (/km)') + stat(repHr ?? '—', 'Rep HR')
    + stat(fmtTime(recE), standing ? 'Recovery (standing)' : 'Recovery at ' + paceOf(recD, recT)) + stat(steadiness, 'Last rep vs first') + '</div>'
    + (detail && detail.s && detail.s.v && detail.s.v.length ? traceChart(detail.s, w) : '')
    + '<table class="run-recs"><thead><tr><th>Rep</th><th>Distance</th><th>Time</th><th>Pace</th><th>HR / max</th><th class="opt">Then</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + (note ? '<div class="ra-note">' + note + '</div>' : '')
    + '</div>';
}


// ---- the whole run: chart, zones ----

// The trace as per-point series: speed and grade-adjusted speed (m/s), heart rate, cadence, elevation
// and distance so far. Elevation comes from Strava's altitude, or is built up from the gradient.
function series(detail){
  const s = detail && detail.s;
  if (!s || !s.v || s.v.length < 24) return null;   // under 2 minutes
  const dt = s.dt || 5, n = s.v.length;
  const sp = s.v.map(v => v / 100);
  const gap = sp.map((v, i) => v * gradeFactor(s.g && s.g[i]));
  const dist = [], alt = [];
  let d = 0, a = 0;
  for (let i = 0; i < n; i++){
    const step = sp[i] * dt;
    if (!s.a) a += (s.g && s.g[i] != null ? s.g[i] / 100 : 0) * step;
    d += step; dist.push(d);
    alt.push(s.a ? s.a[i] : a);
  }
  return { dt, n, sp, gap, hr: s.h, cad: s.c, alt: s.a || s.g ? alt : null, dist };
}
// Centred moving average over k points either side, skipping gaps.
function smoothed(a, k){
  const n = a.length, out = new Array(n);
  for (let i = 0; i < n; i++){ let t = 0, c = 0; for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) if (a[j] != null){ t += a[j]; c++; } out[i] = c ? t / c : null; }
  return out;
}

// Grade-adjusted pace, cadence and moving time for the run as a whole.
export function runSummary(detail){
  const z = series(detail);
  const splits = (detail && detail.splits || []).filter(x => x.d >= 20 && x.t > 0);
  let gapPace = null;
  const withGap = splits.filter(x => x.gap);
  if (withGap.length && sum(withGap.map(x => x.d)) >= 0.9 * sum(splits.map(x => x.d)))
    gapPace = sum(withGap.map(x => x.d / (x.gap / 100))) / (sum(withGap.map(x => x.d)) / 1000);
  let moving = null;
  if (z){
    const mv = z.sp.map((v, i) => v >= STANDING ? i : -1).filter(i => i >= 0);
    moving = mv.length * z.dt;
    if (gapPace == null && mv.length) gapPace = moving / (sum(mv.map(i => z.gap[i])) * z.dt / 1000);
  }
  let cad = detail && detail.cad || null;
  if (!cad && z && z.cad){ const c = z.cad.filter((x, i) => x && z.sp[i] >= STANDING); if (c.length) cad = Math.round(median(c)); }
  return { gapPace, cad, moving };
}

// Stacked pace, heart rate, cadence and elevation charts with one crosshair (activity-charts.js).
export function runChartHtml(detail, summary){
  const z = series(detail);
  if (!z) return '';
  const pace = v => v >= STANDING ? fmtPace(1000 / v) : 'Stopped';
  const moving = z.sp.filter(v => v >= STANDING);
  const avgV = moving.length ? sum(moving) / moving.length : null;
  const channels = [
    { label: 'Pace', unit: '/km', color: '#C084FC', vals: z.sp, fmt: pace, win: 3, smooth: 3, avg: avgV, minSpan: 0.6,
      summary: avgV ? 'Avg <b>' + pace(avgV) + '</b>' : '',
      readFmt: (v, i) => { const g = z.gap[i] != null ? avgAround(z.gap, i, 3) : null; return '<b>' + pace(v) + '</b>' + (v >= STANDING ? ' /km' : '') + (v >= STANDING && g && Math.abs(g - v) / v > 0.02 ? ' · GAP ' + pace(g) : ''); } },
    { label: 'Heart rate', unit: 'bpm', color: '#E5484D', vals: z.hr, fmt: v => String(Math.round(v)), win: 1, minSpan: 20 },
    { label: 'Cadence', unit: 'spm', color: '#F5A524', vals: z.cad, fmt: v => String(Math.round(v)), win: 1, smooth: 2, minSpan: 20 },
  ];
  if (z.alt){
    const al = smoothed(z.alt, 2);
    let gain = 0; for (let i = 1; i < al.length; i++) if (al[i] > al[i - 1]) gain += al[i] - al[i - 1];
    channels.push({ label: 'Elevation', unit: 'm', color: '#8C97A6', vals: al, signed: true, fmt: v => Math.round(v) + '', noAvgLine: true, minSpan: 10,
      summary: 'Gain <b>' + Math.round(gain) + ' m</b> · Max <b>' + Math.round(Math.max(...al)) + ' m</b>' });
  }
  const stat = (v, l) => '<div class="d-stat"><div class="val">' + v + '</div><div class="lbl">' + l + '</div></div>';
  const sm = summary || {};
  const stats = [sm.gapPace ? stat(fmtPace(sm.gapPace), 'Grade-adjusted pace') : '', sm.cad ? stat(sm.cad, 'Cadence (spm)') : '', sm.moving ? stat(fmtTime(sm.moving), 'Moving time') : ''].filter(Boolean);
  return '<div class="panel ra-panel ra-run"><div class="panel-title"><span>Your run</span></div>'
    + (stats.length ? '<div class="d-stats ra-stats ra-stats-' + stats.length + '">' + stats.join('') + '</div>' : '')
    + stackHtml({ dt: z.dt, n: z.n, dist: z.dist, channels }) + '</div>';
}
function avgAround(a, i, k){ let t = 0, c = 0; for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) if (a[j] != null){ t += a[j]; c++; } return c ? t / c : null; }

// Pace zones by grade-adjusted pace against threshold pace, edges halfway between the session paces
// in run.js, plus a Recovery band for anything slower than Easy.
function paceBands(T){
  const zs = PACE_ZONES, edge = k => (zs[k].lo + zs[k + 1].hi) / 2;   // between zone k and the next quicker one
  const out = [{ key:'recovery', name:'Recovery', color:'#8C97A6', min: zs[0].hi + 0.04, max: Infinity }];
  zs.forEach((zn, k) => out.push({ key: zn.id, name: zn.name, color: zn.color, min: k < zs.length - 1 ? edge(k) : 0, max: k ? edge(k - 1) : zs[0].hi + 0.04 }));
  return out.map(b => Object.assign(b, {
    range: b.max === Infinity ? 'slower than ' + fmtPace(T * b.min) : !b.min ? 'under ' + fmtPace(T * b.max) : fmtPace(T * b.min) + '–' + fmtPace(T * b.max),
  }));
}
// Heart rate zones as a share of threshold heart rate (Friel's running zones).
const HR_BANDS = [
  { key:'z1', name:'Recovery', color:'#8C97A6', min:0, max:0.85 },
  { key:'z2', name:'Aerobic', color:'#4C8BF5', min:0.85, max:0.90 },
  { key:'z3', name:'Tempo', color:'#3DBE7A', min:0.90, max:0.95 },
  { key:'z4', name:'Threshold', color:'#E8B93D', min:0.95, max:1.00 },
  { key:'z5', name:'Max', color:'#E5484D', min:1.00, max:Infinity },
];

// Seconds in each pace zone (moving only) and heart rate zone.
export function runZones(detail, { pace, lthr } = {}){
  const z = series(detail);
  if (!z) return null;
  let paceZ = null, hrZ = null;
  if (pace){
    const bands = paceBands(pace), g = smoothed(z.gap, 1);
    const secs = bands.map(() => 0);
    g.forEach((v, i) => {
      if (z.sp[i] < STANDING || !v) return;
      const r = 1000 / v / pace, k = bands.findIndex(b => r >= b.min && r < b.max);
      if (k >= 0) secs[k] += z.dt;
    });
    const tot = sum(secs);
    if (tot >= 120) paceZ = bands.map((b, k) => Object.assign({}, b, { sec: secs[k], pct: secs[k] / tot }));
  }
  if (lthr && z.hr){
    const secs = HR_BANDS.map(() => 0);
    z.hr.forEach(h => { if (h == null) return; const k = HR_BANDS.findIndex(b => h / lthr >= b.min && h / lthr < b.max); if (k >= 0) secs[k] += z.dt; });
    const tot = sum(secs);
    if (tot >= 120) hrZ = HR_BANDS.map((b, k) => Object.assign({}, b, { sec: secs[k], pct: secs[k] / tot,
      range: b.max === Infinity ? Math.round(lthr * b.min) + '+' : !b.min ? 'under ' + Math.round(lthr * b.max) : Math.round(lthr * b.min) + '–' + (Math.round(lthr * b.max) - 1) }));
  }
  return paceZ || hrZ ? { pace: paceZ, hr: hrZ } : null;
}

// One line on how the run's pace was spread. intent: 'easy' when the session was meant to be easy.
export function zoneVerdict(zones, { intent, workout } = {}){
  const p = zones && zones.pace;
  if (!p || workout) return null;
  const pct = k => sum(p.filter(b => k.includes(b.key)).map(b => b.pct));
  const easy = pct(['recovery', 'easy']), hard = 1 - easy, P = x => Math.round(x * 100) + '%';
  if (intent === 'easy') return hard >= 0.2
    ? { tone:'warn', text:'Meant to be easy, but ' + P(hard) + ' was at Steady pace or quicker. Easy runs do the most good when they stay easy.' }
    : { tone:'good', text:'Kept easy, as planned: ' + P(easy) + ' at Easy pace or slower.' };
  if (easy >= 0.85) return { tone:'good', text:'An easy run: ' + P(easy) + ' at Easy pace or slower.' };
  if (easy >= 0.5 && hard >= 0.2) return { tone:'warn', text:'Mostly easy, but ' + P(hard) + ' drifted into Steady or quicker. If this was meant to be an easy run, ease off a little.' };
  const top = p.slice(1).reduce((a, b) => b.pct > a.pct ? b : a);
  return { tone:'', text:'Most of this run was at ' + top.name + ' pace (' + P(top.pct) + ').' };
}

function zoneRows(bands){
  const top = Math.max(...bands.map(b => b.pct));
  return '<div class="ra-zones">' + bands.map(b => '<div class="ra-zrow"><span class="ra-zname"><span><i style="background:' + b.color + '"></i>' + esc(b.name) + '</span>'
    + '<span class="ra-dim">' + esc(b.range) + '</span></span><span class="ra-ztrack"><span style="width:' + (top ? b.pct / top * 100 : 0).toFixed(1) + '%;background:' + b.color + '"></span></span>'
    + '<span class="ra-zt">' + (b.sec ? fmtTime(b.sec) : '–') + '</span><span class="ra-zp">' + Math.round(b.pct * 100) + '%</span></div>').join('') + '</div>';
}

// note: what to show when a zone set is missing (e.g. no threshold pace set).
export function zonesPanelHtml(zones, { verdict, paceNote, hrNote } = {}){
  if (!zones) return paceNote ? '<div class="panel ra-panel"><div class="panel-title"><span>Time in zones</span></div><div class="ra-note" style="margin:0">' + paceNote + '</div></div>' : '';
  const both = zones.pace && zones.hr;
  const tabs = both ? '<div class="seg ra-seg"><button class="on" data-ra-tab="pace">Pace</button><button data-ra-tab="hr">Heart rate</button></div>' : '';
  return '<div class="panel ra-panel"><div class="panel-title"><span>Time in ' + (both ? '' : zones.pace ? 'pace ' : 'heart rate ') + 'zones</span>' + tabs + '</div>'
    + (verdict ? '<div class="ra-verdict ' + verdict.tone + '">' + esc(verdict.text) + '</div>' : '')
    + (zones.pace ? '<div data-ra-pane="pace">' + zoneRows(zones.pace) + '<div class="ra-note">By grade-adjusted pace against your threshold pace, so hills don\'t throw it out.</div></div>' : '')
    + (zones.hr ? '<div data-ra-pane="hr"' + (zones.pace ? ' hidden' : '') + '>' + zoneRows(zones.hr) + (hrNote ? '<div class="ra-note">' + hrNote + '</div>' : '') + '</div>' : '')
    + (!zones.pace && paceNote ? '<div class="ra-note">' + paceNote + '</div>' : '')
    + '</div>';
}

// Splits/Laps and Pace/Heart rate switches inside a panel.
export function wireRunAnalysis(root){
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-ra-tab]'); if (!b) return;
    const panel = b.closest('.ra-panel');
    panel.querySelectorAll('[data-ra-tab]').forEach(x => x.classList.toggle('on', x === b));
    panel.querySelectorAll('[data-ra-pane]').forEach(x => { x.hidden = x.dataset.raPane !== b.dataset.raTab; });
  });
}

export const RUN_ANALYSIS_CSS = `
  .ra-panel .panel-title{ align-items:center; }
  .ra-seg button{ padding:5px 11px; font-size:12px; text-transform:none; letter-spacing:0; color:var(--text); }
  .ra-splits .ra-barcol{ width:38%; padding-left:0; }
  .ra-bar{ display:block; height:8px; border-radius:4px; background:#C084FC; opacity:.8; }
  .ra-splits tr.ra-best .ra-bar{ opacity:1; background:#D8B4FE; }
  .ra-splits tr.ra-best td.t::after{ content:" fastest"; font-family:var(--sans); font-weight:500; font-size:11px; color:#D8B4FE; }
  .ra-src{ text-transform:none; letter-spacing:0; color:#D8B4FE; }
  .ra-stats{ margin-bottom:12px; grid-template-columns:repeat(2, minmax(0,1fr)); }
  @media (min-width:700px){ .ra-stats{ grid-template-columns:repeat(4, minmax(0,1fr)); } }
  .ra-stats .val{ font-size:18px; }
  .ra-chart{ position:relative; height:150px; margin:4px 0 14px; }
  .ra-chart svg{ width:100%; height:150px; display:block; border-radius:8px; background:var(--panel-2); }
  .ra-rep{ fill:rgba(192,132,252,.2); }
  .ra-line{ fill:none; stroke:#C084FC; stroke-width:1.6; stroke-linejoin:round; }
  .ra-guide{ stroke:rgba(231,236,242,.35); stroke-dasharray:4 4; vector-effect:non-scaling-stroke; }
  .ra-ylab{ position:absolute; right:6px; transform:translateY(-120%); font:600 11px var(--mono); color:var(--text); background:rgba(23,29,37,.8); padding:1px 5px; border-radius:4px; }
  .ra-xlab{ display:flex; justify-content:space-between; font:11px var(--mono); color:var(--text-dim); margin-top:4px; }
  .ra-dim{ color:var(--text-dim); opacity:.75; }
  .ra-note{ font-size:12.5px; color:var(--text-dim); margin-top:10px; }
  .ra-splits td.ra-gap{ color:var(--text-dim); }
  .ra-note a{ color:var(--accent); }
  .ra-stats-1{ grid-template-columns:1fr !important; } .ra-stats-2{ grid-template-columns:repeat(2, minmax(0,1fr)) !important; }
  @media (min-width:700px){ .ra-stats-3{ grid-template-columns:repeat(3, minmax(0,1fr)); } }
  @media (max-width:699px){ .ra-stats-3{ grid-template-columns:repeat(3, minmax(0,1fr)); } .ra-stats-3 .val{ font-size:15px; } }
  .ra-verdict{ font-size:13.5px; padding:9px 12px; border-radius:8px; background:var(--panel-2); margin-bottom:12px; }
  .ra-verdict.good{ background:rgba(61,190,122,.12); color:#7FDCAA; } .ra-verdict.warn{ background:rgba(232,185,61,.12); color:#F0CC6E; }
  .ra-zones{ display:grid; gap:9px; }
  .ra-zrow{ display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,2fr) 52px 38px; gap:10px; align-items:center; font-size:13px; }
  .ra-zname{ display:flex; align-items:baseline; gap:4px 8px; min-width:0; flex-wrap:wrap; } .ra-zname i{ display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:7px; }
  .ra-zname .ra-dim{ font:11px var(--mono); }
  .ra-ztrack{ height:9px; border-radius:5px; background:var(--panel-2); overflow:hidden; } .ra-ztrack span{ display:block; height:100%; border-radius:5px; }
  .ra-zt, .ra-zp{ font:12px var(--mono); text-align:right; font-variant-numeric:tabular-nums; } .ra-zp{ color:var(--text-dim); }
  @media (max-width:520px){ .ra-zname{ flex-direction:column; gap:1px; } .ra-zname .ra-dim{ padding-left:16px; } .ra-zrow{ grid-template-columns:minmax(0,1.4fr) minmax(0,1.4fr) 44px 32px; gap:7px; } }
`;
