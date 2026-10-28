// How a rider is getting on towards a goal (goals.js), week by week, rebuilt from history so nothing new
// needs storing beyond the goal's own setAt and start (saved when the goal is set):
//   FTP goal       the FTP in use at each point (NP / IF of the latest ride) or a higher one detected
//                  from power bests (ftp-estimate.js), whichever is higher
//   race goal      the predicted race time from the threshold pace the runs imply (run bests, 90 days)
//   distance goal  the longest ride in the six weeks before each point, against the long ride that
//                  says you're ready (75% of the event's time)
// With a date, an on-track line runs from the start to the target on the day, and "now" is compared to it.
import { isoDate, addDays, daysBetween } from './plan-schedule.js?v=6';
import { RUN_GOALS, predictTime, paceFromRuns, fmtDuration } from './run-plans.js?v=4';
import { estimateFtp } from './ftp-estimate.js?v=1';
import { eventMinutes, currentValue, LONG_SHARE } from './goals.js?v=5';

const dayOf = r => isoDate(new Date(r.started_at));
const hm = mins => { const m = Math.round(mins); return m >= 60 ? Math.floor(m/60)+' h'+(m%60 ? ' '+String(m%60).padStart(2,'0') : '') : m+' min'; };
const WEEKS_BACK = 12;   // history shown before the goal was set (or in all, for a goal set before this existed)

// The value at the end of day `d`, from history up to then.
function valueAt(sport, g, rides, d){
  const before = rides.filter(r => dayOf(r) <= d);
  if (sport === 'run'){
    const est = paceFromRuns(before.filter(r => r.sport === 'run'), new Date(d + 'T23:59:00'));
    return est ? predictTime(g.goal, est.pace) : null;
  }
  const bikes = before.filter(r => (r.sport || 'ride') === 'ride');
  if (g.type === 'ftp'){
    const used = bikes.filter(r => r.np && r.intensity_factor).pop();
    const inUse = used ? Math.round(used.np / used.intensity_factor) : 0;
    const est = estimateFtp(bikes, new Date(d + 'T23:59:00'));
    const v = Math.max(inUse, est ? est.ftp : 0);
    return v || null;
  }
  const since = addDays(d, -42);
  const longest = bikes.filter(r => dayOf(r) > since).reduce((m, r) => Math.max(m, (r.duration_sec || 0) / 60), 0);
  return longest || null;
}

// Returns null without a goal, else
// { unit, better:'up'|'down', fmt(v), points:[{ date, v }], start, now, target, pct, weeksLeft, expected, pace, text }
//   pct: share of the way from start to target (0-100), expected: where the on-track line is today (dated goals),
//   pace: 'ahead' | 'behind' | null.
export function goalProgress(sport, g, ctx){
  if (!g) return null;
  const { rides = [], today = isoDate(new Date()) } = ctx;
  const ftpGoal = sport === 'ride' && g.type === 'ftp', distGoal = sport === 'ride' && g.type === 'distance';
  const target = sport === 'run' ? g.targetSec : ftpGoal ? g.watts : Math.round(eventMinutes(g, rides).mins * LONG_SHARE);
  if (!target) return null;
  const better = sport === 'run' ? 'down' : 'up';
  const fmt = v => v == null ? '—' : sport === 'run' ? fmtDuration(Math.round(v)) : ftpGoal ? Math.round(v) + ' W' : hm(v);
  const from = g.setAt && g.setAt < addDays(today, -7 * WEEKS_BACK) ? g.setAt : addDays(today, -7 * WEEKS_BACK);
  const points = [];
  for (let d = from; d < today; d = addDays(d, 7)){ const v = valueAt(sport, g, rides, d); if (v != null) points.push({ date: d, v }); }
  // Today's point is the same number the goal card shows (the saved FTP or threshold pace counts too).
  const now = currentValue(sport, g, ctx);
  if (now != null) points.push({ date: today, v: now });
  if (!points.length) return { unit: sport, better, fmt, points, start:null, now:null, target, pct:0, weeksLeft:null, expected:null, pace:null,
    text: sport === 'run' ? 'Log a hard run or set your threshold pace to start tracking.' : 'Ride a few times to start tracking.' };
  const setPoint = g.setAt ? points.find(p => p.date >= g.setAt) : null;
  const start = g.start != null ? g.start : setPoint ? setPoint.v : points[0].v;
  const gain = better === 'up' ? target - start : start - target;
  const done = better === 'up' ? (now ?? start) - start : start - (now ?? start);
  const pct = gain <= 0 ? 100 : Math.max(0, Math.min(100, Math.round(done / gain * 100)));
  const weeksLeft = g.date ? Math.max(0, Math.ceil(daysBetween(today, g.date) / 7)) : null;
  let expected = null, pace = null;
  if (g.date && g.setAt && g.date > g.setAt && pct < 100){
    const f = Math.min(1, Math.max(0, daysBetween(g.setAt, today) / daysBetween(g.setAt, g.date)));
    expected = start + (target - start) * f;
    const tol = Math.abs(target - start) * 0.05;   // within 5% of the way counts as on the line
    pace = better === 'up' ? (now >= expected - tol ? 'ahead' : 'behind') : (now <= expected + tol ? 'ahead' : 'behind');
  }
  const diff = now == null ? null : better === 'up' ? target - now : now - target;
  const toGo = diff == null ? '' : diff <= 0 ? 'Reached.' : (sport === 'run' ? fmtDuration(Math.round(diff)) + ' to take off' : ftpGoal ? Math.round(diff) + ' W to go' : hm(diff) + ' more on your long ride') + '.';
  const text = toGo
    + (weeksLeft != null && diff > 0 ? ' ' + weeksLeft + ' week' + (weeksLeft === 1 ? '' : 's') + ' to go' + (pace === 'ahead' ? ', and you\'re on schedule.' : pace === 'behind' ? ', and you\'re behind where you\'d want to be.' : '.') : '');
  return { unit: sport, better, fmt, points, start, now, target, pct, weeksLeft, expected, pace, text, distGoal };
}

// A small line chart of the points, with the target as a dashed line and, for a dated goal, the on-track
// line from the start to the target on the day. Hovering (or tapping) a week shows its value.
// The plot stretches to the card's width at a fixed height; labels are HTML so they stay at text size.
export function progressChartHtml(p, g, esc){
  if (!p || p.points.length < 2) return '';
  const W = 1000, H = 100;
  const first = p.points[0].date, last = g.date && g.date > p.points[p.points.length - 1].date ? g.date : p.points[p.points.length - 1].date;
  const span = Math.max(1, daysBetween(first, last));
  const vals = p.points.map(x => x.v).concat([p.target, p.start]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || hi * 0.05 || 1; lo -= pad; hi += pad;
  const x = d => W * daysBetween(first, d) / span;
  // a race time is better lower, so the chart is flipped: up is always better
  const y = v => p.better === 'up' ? H * (hi - v) / (hi - lo) : H * (v - lo) / (hi - lo);
  const f = n => n.toFixed(1);
  const at = (px, py) => 'left:' + f(px / W * 100) + '%;top:' + f(py / H * 100) + '%';
  const line = p.points.map((pt, i) => (i ? 'L' : 'M') + f(x(pt.date)) + ' ' + f(y(pt.v))).join(' ');
  const area = line + ' L' + f(x(p.points[p.points.length - 1].date)) + ' ' + H + ' L0 ' + H + ' Z';
  const end = p.points[p.points.length - 1];
  const track = g.date && g.setAt && g.date > g.setAt && g.setAt >= first
    ? '<path class="gp-track" d="M' + f(x(g.setAt)) + ' ' + f(y(p.start)) + ' L' + f(x(g.date)) + ' ' + f(y(p.target)) + '"/>' : '';
  const month = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
  const step = W / Math.max(1, p.points.length - 1);
  const hits = p.points.map((pt, i) => '<rect class="gp-hit" x="' + f(x(pt.date) - step / 2) + '" y="0" width="' + f(step) + '" height="' + H + '"><title>' + esc(month(pt.date) + ': ' + p.fmt(pt.v)) + '</title></rect>').join('');
  const nearTarget = Math.abs(y(end.v) - y(p.target)) < 13;
  const atEdge = x(end.date) > W - 1;
  return '<figure class="gp-chart" role="img" aria-label="' + esc('Progress: ' + p.fmt(p.start) + ' to ' + p.fmt(p.now) + ', target ' + p.fmt(p.target)) + '"><div class="gp-plot">'
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<line class="gp-base" x1="0" x2="' + W + '" y1="' + H + '" y2="' + H + '"/>'
    + '<line class="gp-target" x1="0" x2="' + W + '" y1="' + f(y(p.target)) + '" y2="' + f(y(p.target)) + '"/>'
    + track
    + '<path class="gp-area" d="' + area + '"/><path class="gp-line" d="' + line + '"/>'
    + hits + '</svg>'
    + '<i class="gp-end" style="' + at(x(end.date), y(end.v)) + '"></i>'
    + '<span class="gp-tl" style="' + at(W, y(p.target)) + '">' + esc(p.fmt(p.target)) + '</span>'
    + '<span class="gp-nl' + (atEdge ? ' edge' : '') + (nearTarget ? ' low' : '') + '" style="' + at(x(end.date), y(end.v)) + '">' + esc(p.fmt(end.v)) + '</span>'
    + '<span class="gp-dl" style="left:0">' + esc(month(first)) + '</span>'
    + '<span class="gp-dl r" style="left:100%">' + esc(g.date && g.date > end.date ? month(g.date) : 'Today') + '</span>'
    + '</div><figcaption>' + (p.better === 'down' ? 'Predicted time, faster is up. ' : '') + 'Dashed: your target' + (track ? '; dotted: where you need to be to hit it on the day' : '') + '.</figcaption></figure>';
}

export const PROGRESS_CSS = `
.gp-bar{ height:6px; border-radius:99px; background:var(--panel-2, #1D242D); margin-top:8px; overflow:hidden; }
.gp-bar i{ display:block; height:100%; border-radius:99px; background:var(--accent, #45D6C4); }
.gp-meta{ display:flex; justify-content:space-between; gap:8px; margin-top:4px; font-size:12px; color:var(--text-dim, #8C97A6); font-variant-numeric:tabular-nums; }
.gp-meta b{ color:var(--text, #E7ECF2); font-weight:600; }
.gp-chart{ margin:10px 0 0; cursor:default; }
.gp-text{ margin:6px 0 0 !important; }
.gp-plot{ position:relative; height:110px; margin:8px 52px 20px 0; }
.gp-plot svg{ position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
.gp-chart figcaption{ font-size:12px; color:var(--text-dim, #8C97A6); margin-top:4px; }
.gp-base{ stroke:var(--line, #2A323D); stroke-width:1; vector-effect:non-scaling-stroke; }
.gp-target{ stroke:var(--text-dim, #8C97A6); stroke-width:1.5; stroke-dasharray:6 5; vector-effect:non-scaling-stroke; }
.gp-track{ stroke:var(--text-dim, #8C97A6); stroke-width:1.5; stroke-dasharray:2 4; fill:none; stroke-linecap:round; vector-effect:non-scaling-stroke; }
.gp-line{ fill:none; stroke:var(--accent, #45D6C4); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; vector-effect:non-scaling-stroke; }
.gp-area{ fill:var(--accent, #45D6C4); opacity:.1; }
.gp-end{ position:absolute; width:9px; height:9px; margin:-6.5px 0 0 -6.5px; border-radius:50%; background:var(--accent, #45D6C4); border:2px solid var(--panel, #171D25); pointer-events:none; }
.gp-tl, .gp-nl, .gp-dl{ position:absolute; font-size:11px; line-height:1; color:var(--text-dim, #8C97A6); font-family:var(--mono, ui-monospace, monospace); white-space:nowrap; pointer-events:none; }
.gp-tl{ transform:translate(6px, -50%); }
.gp-nl{ color:var(--text, #E7ECF2); font-weight:600; transform:translate(8px, -50%); }
.gp-nl.edge{ transform:translate(6px, -50%); }
.gp-nl.low{ transform:translate(6px, 60%); }
.gp-dl{ top:calc(100% + 6px); }
.gp-dl.r{ transform:translateX(-100%); }
.gp-hit{ fill:transparent; cursor:default; }
.gp-hit:hover{ fill:var(--text, #E7ECF2); opacity:.06; }
`;
export function ensureProgressCss(){
  if (document.getElementById('tc-gp-style')) return;
  const s = document.createElement('style'); s.id = 'tc-gp-style'; s.textContent = PROGRESS_CSS; document.head.appendChild(s);
}
// The bar shown under a goal on its card: how far along, and the weeks left.
export function progressBarHtml(p){
  if (!p || p.start == null) return '';
  return '<div class="gp-bar" role="progressbar" aria-valuenow="' + p.pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + p.pct + '%"></i></div>'
    + '<div class="gp-meta"><span><b>' + p.pct + '%</b> of the way · ' + p.fmt(p.start) + ' → ' + p.fmt(p.now) + ' → ' + p.fmt(p.target) + '</span>'
    + (p.weeksLeft != null ? '<span>' + p.weeksLeft + ' wk' + (p.weeksLeft === 1 ? '' : 's') + ' left</span>' : '') + '</div>';
}
