// Splits, laps and interval workouts for runs imported from Strava (completed_rides.run_detail, filled
// by strava-import { detail: id } the first time a run is opened; shape in 2026-10-28-run-detail.sql).
// A run only gets a workout analysis when the intervals are clear: from the laps when the watch
// recorded them (lap button or a structured workout), otherwise from the pace trace. Anything
// borderline (a hilly easy run, a fartlek with no pattern, a few strides) shows splits only.
import { fmtPace, fmtKm } from './run.js?v=9';

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
const gradeFactor = g => g == null ? 1 : (g = Math.max(-15, Math.min(15, g)), g > 0 ? 1 + 0.033 * g : 1 + 0.018 * g);

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
  let km = 0;
  return '<table class="run-recs ra-splits"><thead><tr><th>Km</th><th>Pace</th><th class="ra-barcol"></th><th>HR</th><th class="opt">Elev</th></tr></thead><tbody>'
    + splits.map((x, i) => {
      km += x.d;
      const whole = x.d >= 980;
      const w = top > low ? 35 + 65 * (speeds[i] - low) / (top - low) : 100;
      return '<tr' + (i === fastest ? ' class="ra-best"' : '') + '><td class="p">' + (whole ? Math.round(km / 1000) : (x.d / 1000).toFixed(2)) + '</td>'
        + '<td class="t">' + paceOf(x.d, x.t) + '</td><td class="ra-barcol"><span class="ra-bar" style="width:' + w.toFixed(0) + '%"></span></td>'
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

// Splits/Laps switch inside the panel.
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
`;
