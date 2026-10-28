// Aerobic efficiency: how much work each heartbeat buys. On rides that's watts per beat (NP / average
// heart rate), on runs metres per beat (speed in m/min / average heart rate). Rising efficiency on
// steady sessions is the clearest sign easy training is working. Decoupling compares the first half
// of a steady session with the second: under 5% means the effort was held comfortably.
// Per session from the second-by-second data (rides) or the Strava trace (runs); the trend comes from
// the saved totals so it covers every ride and run without loading their samples.

const sum = a => a.reduce((x, y) => x + y, 0);
const median = a => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const WARMUP = 300;            // heart rate lags at the start, so the first 5 minutes are left out
const MIN_SEC = 1200;          // 20 minutes of power (or pace) and heart rate together
const STEADY_IF = 0.88;        // harder than this isn't an aerobic session
const STEADY_VI = 1.1;         // spikier than this is intervals or surging
// Workout categories built around hard efforts: their heart rate doesn't track power steadily.
const HARD = new Set(['threshold', 'vo2max', 'anaerobic', 'over_under', 'test', 'sweet_spot']);
const DAY = 86400000;

// Normalized power from per-second watts (30 s rolling average, 4th power mean).
function np(watts){
  if (watts.length < 30) return null;
  let roll = 0, acc = 0, n = 0;
  for (let i = 0; i < watts.length; i++){
    roll += watts[i]; if (i >= 30) roll -= watts[i - 30];
    if (i >= 29){ acc += (roll / 30) ** 4; n++; }
  }
  return n ? Math.pow(acc / n, 0.25) : null;
}

// Decoupling between the two halves: (first ratio - second ratio) / first ratio, as a percentage.
// work and hr are per-point arrays (null where there's no reading); only points with both count.
function halves(work, hr){
  const idx = work.map((_, i) => i).filter(i => work[i] != null && hr[i]);
  if (idx.length < 2) return null;
  const mid = idx.length >> 1, ratio = ids => sum(ids.map(i => work[i])) / sum(ids.map(i => hr[i]));
  const a = ratio(idx.slice(0, mid)), b = ratio(idx.slice(mid));
  return a > 0 ? (a - b) / a * 100 : null;
}

// A ride from Live Ride: sec = [{ power, hr }] one per second.
export function rideEfficiency(sec, { intensity, category } = {}){
  if (!sec || sec.length < WARMUP + MIN_SEC) return null;
  const s = sec.slice(WARMUP);
  const both = s.filter(x => x.power > 0 && x.hr > 0);
  if (both.length < MIN_SEC || both.length < 0.8 * s.length) return null;
  const watts = s.map(x => x.power || 0), n = np(watts), avgP = sum(watts) / watts.length;
  const avgHr = sum(both.map(x => x.hr)) / both.length;
  if (!n || !avgHr) return null;
  const vi = avgP > 0 ? n / avgP : null;
  const steady = (intensity == null || intensity <= STEADY_IF) && vi != null && vi <= STEADY_VI && !HARD.has(category);
  return { kind: 'ride', ef: n / avgHr, vi, steady,
    decoupling: steady ? halves(s.map(x => x.power > 0 ? x.power : null), s.map(x => x.hr || null)) : null };
}

// A run's Strava trace (run_detail.s): grade-adjusted speed per beat, moving time only.
// gradeFactor is run-analysis.js's, passed in so both agree on hills.
export function runEfficiency(s, { intensity, workout, gradeFactor } = {}){
  if (!s || !s.v || !s.h) return null;
  const dt = s.dt || 5, skip = Math.round(WARMUP / dt);
  const gap = [], hr = [];
  for (let i = skip; i < s.v.length; i++){
    const v = s.v[i] / 100;
    const moving = v >= 1.5 && s.h[i];   // walking and stops leave heart rate behind the pace
    gap.push(moving ? v * 60 * (gradeFactor ? gradeFactor(s.g && s.g[i]) : 1) : null);
    hr.push(moving ? s.h[i] : null);
  }
  const ok = gap.filter(x => x != null).length;
  if (ok * dt < MIN_SEC) return null;
  const ef = sum(gap.filter(x => x != null)) / sum(hr.filter((x, i) => gap[i] != null));
  const steady = !workout && (intensity == null || intensity <= STEADY_IF);
  return { kind: 'run', ef, steady, decoupling: steady ? halves(gap, hr) : null };
}

// From saved totals, for the trend. Rides: NP and average heart rate on steady rides. Runs: average
// speed and heart rate on easy, fairly flat runs (no stream, so hills would skew it).
export function sessionEf(r){
  const dur = Number(r.duration_sec) || 0, hr = Number(r.avg_hr) || 0, IF = r.intensity_factor != null ? Number(r.intensity_factor) : null;
  if (!hr || dur < MIN_SEC + WARMUP || (IF != null && IF > STEADY_IF)) return null;
  if (r.sport === 'run'){
    const km = (Number(r.distance_m) || 0) / 1000;
    if (km < 3 || (Number(r.elevation_m) || 0) / km > 15) return null;
    return r.distance_m / (dur / 60) / hr;
  }
  if ((r.sport || 'ride') !== 'ride' || !r.np || HARD.has(r.category)) return null;
  return r.np / hr;
}

// Weekly medians over the last `weeks` and the change between the last 4 weeks and 6-12 weeks ago.
export function efficiencyTrend(rides, sport, { today = new Date(), weeks = 16 } = {}){
  const end = new Date(today); end.setHours(23, 59, 59, 999);
  const pts = rides.filter(r => (sport === 'run' ? r.sport === 'run' : (r.sport || 'ride') === 'ride'))
    .map(r => ({ t: new Date(r.started_at).getTime(), ef: sessionEf(r) }))
    .filter(p => p.ef && p.t > end - weeks * 7 * DAY && p.t <= end);
  if (pts.length < 3) return { sport, n: pts.length, points: [], change: null };
  const points = [];
  for (let w = weeks - 1; w >= 0; w--){
    const a = end - (w + 1) * 7 * DAY, b = end - w * 7 * DAY;
    const inWeek = pts.filter(p => p.t > a && p.t <= b).map(p => p.ef);
    points.push(inWeek.length ? median(inWeek) : null);
  }
  const recent = pts.filter(p => p.t > end - 28 * DAY).map(p => p.ef);
  const before = pts.filter(p => p.t <= end - 42 * DAY && p.t > end - 84 * DAY).map(p => p.ef);
  const change = recent.length >= 2 && before.length >= 2 ? (median(recent) - median(before)) / median(before) : null;
  return { sport, n: pts.length, points, change, now: recent.length ? median(recent) : null };
}

const UNIT = { ride: 'W per beat', run: 'm per beat' };

// One line on a session's decoupling.
function decouplingText(d){
  if (d < 5) return { tone: 'good', text: 'Held steady: your heart rate barely drifted against your effort. Under 5% means your aerobic fitness carried this comfortably.' };
  if (d < 8) return { tone: 'warn', text: 'Some drift late on. That\'s normal on a long or warm session; if it\'s usual for this length, more easy volume will bring it down.' };
  return { tone: 'warn', text: 'Your heart rate climbed a lot for the same effort. The session was longer or harder than your aerobic base holds yet, or heat or fuelling played a part.' };
}

// Panel for a ride or run detail page. usual: the rider's median efficiency on steady sessions in the
// last 8 weeks, and own: this session's figure worked out the same way (sessionEf), so the two compare
// like for like.
export function efficiencyPanelHtml(e, usual, own){
  if (!e) return '';
  const unit = UNIT[e.kind];
  const stat = (v, l) => '<div class="d-stat"><div class="val">' + v + '</div><div class="lbl">' + l + '</div></div>';
  const vs = usual && own && e.steady ? (own - usual) / usual : null;
  const stats = [stat(e.ef.toFixed(2), 'Efficiency (' + unit + ')'),
    e.decoupling != null ? stat((e.decoupling < 0 ? '−' : '') + Math.abs(e.decoupling).toFixed(1) + '%', 'Decoupling') : '',
    e.kind === 'ride' && e.vi ? stat(e.vi.toFixed(2), 'Variability') : '',
    vs != null ? stat((vs >= 0 ? '+' : '−') + Math.abs(vs * 100).toFixed(0) + '%', 'Vs your usual') : ''].filter(Boolean);
  const d = e.decoupling != null ? decouplingText(e.decoupling) : null;
  const what = e.kind === 'ride' ? 'how many watts each heartbeat gives you' : 'how far each heartbeat carries you, adjusted for hills';
  const note = 'Efficiency is ' + what + '; higher is better.' + (e.steady ? '' : ' Decoupling is only worked out on steady ' + (e.kind === 'ride' ? 'rides' : 'runs') + ', since hard efforts make heart rate jump around.');
  return '<div class="panel ef-panel"><div class="panel-title"><span>Efficiency</span></div>'
    + '<div class="d-stats ef-stats ef-n' + stats.length + '">' + stats.join('') + '</div>'
    + (d ? '<div class="ef-verdict ' + d.tone + '">' + d.text + '</div>' : '')
    + '<div class="ef-note">' + note + (vs != null ? ' "Vs your usual" compares with your steady ' + (e.kind === 'ride' ? 'rides' : 'runs') + ' over the last 8 weeks.' : '') + '</div></div>';
}

// Median efficiency on steady sessions of one sport over the last 8 weeks, excluding `skipId`.
export function usualEf(rides, sport, skipId, today = new Date()){
  const since = today.getTime() - 56 * DAY;
  const v = rides.filter(r => r.id !== skipId && (sport === 'run' ? r.sport === 'run' : (r.sport || 'ride') === 'ride') && new Date(r.started_at).getTime() > since)
    .map(sessionEf).filter(Boolean);
  return v.length >= 3 ? median(v) : null;
}

// "Is your engine improving?" for Fitness & form: one row per sport with a weekly chart.
export function engineCardHtml(trends){
  const rows = trends.filter(t => t.n >= 3);
  if (!rows.length) return '<div class="panel ef-card"><div class="panel-title"><span>Is your engine improving?</span></div>'
    + '<div class="ef-note" style="margin:0">After a few steady rides or easy runs with heart rate, this shows whether the same heart rate is giving you more power or pace. That\'s the clearest sign your easy training is working.</div></div>';
  const row = t => {
    const label = t.sport === 'run' ? 'Easy runs' : 'Steady rides';
    let text;
    if (t.change == null) text = 'Keep going: we need a few more weeks of ' + label.toLowerCase() + ' to show a trend.';
    else if (t.change >= 0.02) text = 'Up ' + Math.round(t.change * 100) + '% on two months ago. The same heart rate now gives you more ' + (t.sport === 'run' ? 'pace' : 'power') + ': your aerobic fitness is growing.';
    else if (t.change <= -0.02) text = 'Down ' + Math.round(-t.change * 100) + '% on two months ago. Tiredness, heat or illness can do this. If it keeps slipping, add more easy ' + (t.sport === 'run' ? 'running' : 'riding') + '.';
    else text = 'Holding steady on two months ago.';
    const chip = t.change == null ? '' : '<span class="ef-chip ' + (t.change >= 0.02 ? 'up' : t.change <= -0.02 ? 'down' : '') + '">' + (t.change >= 0 ? '+' : '−') + Math.abs(t.change * 100).toFixed(0) + '%</span>';
    return '<div class="ef-row"><div class="ef-head"><span class="ef-label">' + label + '</span><span class="ef-now">' + (t.now ? t.now.toFixed(2) + ' ' + UNIT[t.sport] : '') + '</span>' + chip + '</div>'
      + sparkline(t.points, t.sport) + '<div class="ef-text">' + text + '</div></div>';
  };
  return '<div class="panel ef-card"><div class="panel-title"><span>Is your engine improving?</span><span class="ef-sub">Efficiency, last 16 weeks</span></div>'
    + rows.map(row).join('') + '</div>';
}

function sparkline(points, sport){
  const vals = points.filter(v => v != null);
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max((hi - lo) * 0.15, hi * 0.01);
  const W = 1000, H = 60, n = points.length;
  const x = i => (i + 0.5) / n * W, y = v => H - 4 - (v - lo + pad) / (hi - lo + 2 * pad) * (H - 8);
  const pts = points.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
  const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const color = sport === 'run' ? '#C084FC' : '#45D6C4';
  const last = pts[pts.length - 1];
  return '<div class="ef-spark"><div class="ef-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<polyline points="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>'
    + '<span class="ef-dot" style="left:' + (last[0] / W * 100).toFixed(1) + '%;top:' + (last[1] / H * 100).toFixed(1) + '%;background:' + color + '"></span></div>'
    + '<div class="ef-x"><span>16 weeks ago</span><span>This week</span></div></div>';
}

export const EFFICIENCY_CSS = `
  .ef-stats{ grid-template-columns:repeat(2, minmax(0,1fr)) !important; margin-bottom:10px; }
  @media (min-width:700px){ .ef-stats.ef-n3{ grid-template-columns:repeat(3, minmax(0,1fr)) !important; } .ef-stats.ef-n4{ grid-template-columns:repeat(4, minmax(0,1fr)) !important; } }
  .ef-stats .val{ font-size:18px; }
  .ef-verdict{ font-size:13.5px; padding:9px 12px; border-radius:8px; background:var(--panel-2); margin-bottom:8px; }
  .ef-verdict.good{ background:rgba(61,190,122,.12); color:#7FDCAA; } .ef-verdict.warn{ background:rgba(232,185,61,.12); color:#F0CC6E; }
  .ef-note{ font-size:12.5px; color:var(--text-dim); }
  .ef-sub{ text-transform:none; letter-spacing:0; color:var(--text-dim); font-size:12px; }
  .ef-row + .ef-row{ margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }
  .ef-head{ display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .ef-label{ font-weight:600; } .ef-now{ font:12.5px var(--mono); color:var(--text-dim); }
  .ef-chip{ margin-left:auto; font:600 12px var(--mono); padding:2px 8px; border-radius:999px; background:var(--panel-2); }
  .ef-chip.up{ background:rgba(61,190,122,.15); color:#7FDCAA; } .ef-chip.down{ background:rgba(232,185,61,.15); color:#F0CC6E; }
  .ef-spark{ margin:8px 0 4px; } .ef-plot{ position:relative; height:60px; }
  .ef-spark svg{ width:100%; height:60px; display:block; }
  .ef-dot{ position:absolute; width:8px; height:8px; border-radius:50%; transform:translate(-50%,-50%); box-shadow:0 0 0 3px var(--panel); }
  .ef-x{ display:flex; justify-content:space-between; font:11px var(--mono); color:var(--text-dim); }
  .ef-text{ font-size:13.5px; margin-top:6px; }
`;
