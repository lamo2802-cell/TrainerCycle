// "Compare with last time": an indoor workout against earlier rides of the same workout, and an
// outdoor run or ride against earlier ones on the same route. Same workout is matched by workout_id;
// same route by the Strava route line (start, finish and the path in between all close, similar
// distance), so a loop run the other way round or a detour doesn't count.
import { decodePolyline, hasRoute } from './route-map.js?v=3';
import { fmtPace } from './run.js?v=9';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const FEEL = ['', 'Easy', 'Moderate', 'Hard', 'Very hard', 'All out'];
const NEAR = 200;        // metres: start and finish this close count as the same place
const PATH = 250;        // metres: every sampled point of the route this close to the other one
const DIST = 0.08;       // distances within 8%
const SHOW = 6;          // rows in the table

function metres(a, b){
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const thin = (pts, max) => pts.length <= max ? pts : pts.filter((_, i) => i % Math.ceil(pts.length / max) === 0);

// True when two decoded routes are the same course in the same direction.
function sameCourse(a, b){
  if (a.length < 2 || b.length < 2) return false;
  if (metres(a[0], b[0]) > NEAR || metres(a[a.length - 1], b[b.length - 1]) > NEAR) return false;
  const bt = thin(b, 300);
  // A dozen points along a, each in order along b, so the same loop run backwards fails.
  let from = 0;
  for (let k = 1; k <= 12; k++){
    const p = a[Math.floor(k / 13 * (a.length - 1))];
    let best = Infinity, at = from;
    for (let j = from; j < bt.length; j++){ const d = metres(p, bt[j]); if (d < best){ best = d; at = j; } }
    if (best > PATH) return false;
    from = at;
  }
  return true;
}

// Earlier and later activities on the same route as r, newest first. Loads candidates of the same
// sport and similar distance with their route lines.
export async function loadSameRoute(supabase, userId, r){
  if (!hasRoute(r) || !r.distance_m) return [];
  const { data, error } = await supabase.from('completed_rides')
    .select('id,started_at,duration_sec,distance_m,avg_hr,np,avg_power,elevation_m,feel,route_polyline,sport')
    .eq('user_id', userId).eq('sport', r.sport || 'ride')
    .gte('distance_m', Math.round(r.distance_m * (1 - DIST))).lte('distance_m', Math.round(r.distance_m * (1 + DIST)))
    .order('started_at', { ascending: false }).limit(200);
  if (error || !data) return [];
  const mine = decodePolyline(r.route_polyline);
  return data.filter(x => x.id !== r.id && hasRoute(x) && sameCourse(mine, decodePolyline(x.route_polyline)));
}

// Other rides of the same indoor workout, from the activity list, newest first.
export function sameWorkout(r, rides){
  if (!r.workout_id) return [];
  return rides.filter(x => x.id !== r.id && x.workout_id === r.workout_id && x.completed !== false && (x.sport || 'ride') === 'ride'
    && x.source !== 'strava' && x.source !== 'manual')
    .sort((a, b) => a.started_at < b.started_at ? 1 : -1);
}

const shortDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function fmtTime(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}
const hrBit = (now, then) => {
  if (!now || !then) return '';
  const d = now - then;
  return Math.abs(d) < 2 ? ' at the same heart rate' : ' with your heart rate ' + Math.abs(d) + ' bpm ' + (d < 0 ? 'lower' : 'higher');
};

// The headline and table. kind: 'workout' | 'route'. others: from sameWorkout / loadSameRoute.
export function compareHtml(kind, r, others){
  if (!others.length) return '';
  others = others.slice().sort((a, b) => a.started_at < b.started_at ? 1 : -1);
  const before = others.filter(x => x.started_at < r.started_at);
  const all = [r].concat(others).sort((a, b) => a.started_at < b.started_at ? 1 : -1);
  const nth = before.length + 1, prev = before[0];
  const run = r.sport === 'run';
  let head;
  if (!prev) head = 'Your first time on this ' + (kind === 'workout' ? 'workout' : 'route') + '. You\'ve ' + (kind === 'workout' ? 'ridden' : run ? 'run' : 'ridden') + ' it ' + (others.length === 1 ? 'once' : others.length + ' times') + ' since.';
  else if (kind === 'workout'){
    const p = r.avg_power, q = prev.avg_power;
    let what;
    if (p && q){
      const d = (p - q) / q;
      what = Math.abs(d) <= 0.03 ? 'Same power as last time (' + p + ' W)' : Math.abs(p - q) + ' W ' + (p > q ? 'more' : 'less') + ' than last time';
      what += hrBit(r.avg_hr, prev.avg_hr) + '.';
      if (Math.abs(d) <= 0.03 && r.avg_hr && prev.avg_hr && prev.avg_hr - r.avg_hr >= 3) what += ' The same work is costing you less.';
    } else what = 'Last time was ' + shortDate(prev.started_at) + '.';
    const felt = r.feel && prev.feel && r.feel !== prev.feel ? ' It felt ' + (r.feel < prev.feel ? 'easier' : 'harder') + ' than last time.' : '';
    head = 'Your ' + ordinal(nth) + ' time doing this workout. ' + what + felt;
  } else {
    const d = r.duration_sec - prev.duration_sec;
    const time = Math.abs(d) < 5 ? 'The same time as last time' : fmtTime(Math.abs(d)) + ' ' + (d < 0 ? 'quicker' : 'slower') + ' than last time';
    const best = before.reduce((a, b) => b.duration_sec < a.duration_sec ? b : a);
    const bestBit = r.duration_sec < best.duration_sec ? ' Your quickest time on this route.' : ' Your best here is ' + fmtTime(best.duration_sec) + ' (' + shortDate(best.started_at) + ').';
    head = 'Your ' + ordinal(nth) + ' time on this route. ' + time + ' (' + shortDate(prev.started_at) + ')' + hrBit(r.avg_hr, prev.avg_hr) + '.' + bestBit;
  }
  const cols = kind === 'workout'
    ? [['Avg W', x => x.avg_power ?? '–'], ['Avg HR', x => x.avg_hr ?? '–'], ['W/beat', x => x.avg_power && x.avg_hr ? (x.avg_power / x.avg_hr).toFixed(2) : '–'], ['Felt', x => FEEL[x.feel] || '–']]
    : [['Time', x => fmtTime(x.duration_sec)], [run ? 'Pace' : 'Speed', x => run ? fmtPace(x.duration_sec / (x.distance_m / 1000)) : (x.distance_m / 1000 / (x.duration_sec / 3600)).toFixed(1)],
      ['Avg HR', x => x.avg_hr ?? '–'], [run ? 'm/beat' : (all.some(x => x.np) ? 'NP' : ''), x => run ? (x.avg_hr ? (x.distance_m / (x.duration_sec / 60) / x.avg_hr).toFixed(2) : '–') : (x.np ?? '–')]].filter(c => c[0]);
  const rows = all.slice(0, SHOW).map(x => '<tr' + (x.id === r.id ? ' class="cmp-this"' : '') + '><td>' + (x.id === r.id ? 'This one' : esc(shortDate(x.started_at))) + '</td>'
    + cols.map(c => '<td>' + c[1](x) + '</td>').join('') + '</tr>').join('');
  return '<div class="panel cmp-panel"><div class="panel-title"><span>' + (kind === 'workout' ? 'Compared with last time' : 'Same route') + '</span>'
    + '<span class="cmp-n">' + all.length + ' ' + (kind === 'workout' ? 'rides' : run ? 'runs' : 'rides') + '</span></div>'
    + '<div class="cmp-head">' + esc(head) + '</div>'
    + '<div class="cmp-wrap"><table class="cmp"><thead><tr><th></th>' + cols.map(c => '<th>' + c[0] + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + (all.length > SHOW ? '<div class="cmp-more">and ' + (all.length - SHOW) + ' more</div>' : '') + '</div>';
}

export const COMPARE_CSS = `
  .cmp-n{ text-transform:none; letter-spacing:0; color:var(--text-dim); font-size:12px; }
  .cmp-head{ font-size:14px; margin-bottom:10px; }
  .cmp-wrap{ overflow-x:auto; }
  .cmp{ width:100%; border-collapse:collapse; font-size:13px; }
  .cmp th{ text-align:left; font-weight:500; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--text-dim); padding:6px 8px; border-bottom:1px solid var(--line); }
  .cmp td{ padding:7px 8px; border-bottom:1px solid var(--line); font-family:var(--mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .cmp td:first-child{ font-family:inherit; }
  .cmp tr:last-child td{ border-bottom:none; }
  .cmp tr.cmp-this td{ color:var(--accent); font-weight:600; }
  .cmp-more{ font-size:12px; color:var(--text-dim); margin-top:6px; }
`;
