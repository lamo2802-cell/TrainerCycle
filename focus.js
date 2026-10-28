// "Your focus": up to three things to work on, read from the last few weeks of rides and runs. It works
// with or without goals (goals.js) and nothing is stored. Each point can carry zone weights, which go
// into the suggested ride and run the same way a goal's do, so the focus the rider reads is the focus
// the suggestion follows. focusWeights() adds them up per sport for suggestRide/suggestRun (`focus`).
import { isoDate, addDays, daysBetween } from './plan-schedule.js?v=6';
import { zoneInfo } from './levels.js?v=1';
import { runZoneInfo } from './run-levels.js?v=1';

const dayOf = r => isoDate(new Date(r.started_at));
const hm = mins => { const m = Math.round(mins); return m >= 60 ? Math.floor(m/60)+' h'+(m%60 ? ' '+String(m%60).padStart(2,'0') : '') : m+' min'; };
const zn = z => zoneInfo(z).name.replace('VO2 Max', 'VO2');
const rzn = z => runZoneInfo(z).name;
const LEVEL_CHECK = ['endurance', 'tempo', 'sweet_spot', 'threshold', 'vo2max'];   // anaerobic is a sharpener: never "behind"
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// rides: completed_rides (all sports). byRide/levels: computeLevels(). byRun/runLevels: computeRunLevels().
// guides: { ride, run } from guidesFor() (goals.js), or nulls. rideZone(r, byRide): from suggest.js.
// ftpSetAt: when the FTP setting was last saved (settings.updated_at), or null.
// Returns [{ key, sport, title, text, weights, action }] (at most 3), most useful first.
// action: optional { label, href } for a button.
export function focusPoints({ rides, byRide = {}, levels = {}, byRun = {}, runLevels = null, guides = {}, rideZone, ftpSetAt = null, today }){
  const out = [];
  const since = n => addDays(today, -n);
  const past = rides.filter(r => dayOf(r) < today);
  const bikes = past.filter(r => (r.sport || 'ride') === 'ride');
  const runs = past.filter(r => r.sport === 'run');
  const lastSince = list => { const d = list.map(dayOf).sort().pop(); return d ? daysBetween(d, today) : null; };
  if (!past.length || lastSince(past) > 10) return out;   // new, or on a break: the status already says what to do

  // 1. A zone the goal needs that's been left out.
  [['ride', guides.ride, bikes, r => rideZone(r, byRide), zn], ['run', guides.run, runs, r => byRun[r.id] && byRun[r.id].zone, rzn]].forEach(([sport, gd, list, zoneOf, name]) => {
    if (!gd) return;
    const strong = gd.key.filter(z => (gd.weights[z] || 0) >= 0.4);
    const gaps = strong.map(z => { const d = list.filter(r => zoneOf(r) === z).map(dayOf).sort().pop(); return { z, days: d ? daysBetween(d, today) : null }; })
      .filter(x => x.days == null || x.days >= 14).sort((a, b) => (b.days ?? 99) - (a.days ?? 99));
    if (!gaps.length) return;
    const g = gaps[0];
    out.push({ key: sport + '-goal-gap', sport, title: 'No ' + name(g.z).toLowerCase() + ' ' + (sport === 'run' ? 'running' : 'work') + (g.days == null ? ' yet' : ' for ' + g.days + ' days'),
      text: gd.phrase.charAt(0).toUpperCase() + gd.phrase.slice(1) + ' needs it. One ' + name(g.z).toLowerCase() + ' session this week ' + (g.days == null ? 'gets you started.' : 'gets it going again.'),
      weights: { [g.z]: 0.4 } });
  });

  // 2. Riding stuck in the middle: lots of tempo and sweet spot, little that's really easy or really hard.
  const time = {};
  let total = 0;
  bikes.filter(r => dayOf(r) >= since(28)).forEach(r => { const z = rideZone(r, byRide); if (!z) return; const m = (r.duration_sec || 0) / 60; time[z] = (time[z] || 0) + m; total += m; });
  if (total >= 240){
    const mid = ((time.tempo || 0) + (time.sweet_spot || 0)) / total;
    const hard = ((time.threshold || 0) + (time.vo2max || 0) + (time.anaerobic || 0)) / total;
    if (mid > 0.4 && hard < 0.2) out.push({ key:'ride-grey', sport:'ride', title:'Most of your riding is moderate',
      text: Math.round(mid * 100) + '% of your riding in the last 4 weeks was tempo or sweet spot. Make one ride a week truly easy and one truly hard: that builds more than lots of medium.',
      weights: { endurance:0.25, threshold:0.15, vo2max:0.3, tempo:-0.3, sweet_spot:-0.3 } });
  }

  // 3. Easy runs that aren't easy.
  const ifRuns = runs.filter(r => dayOf(r) >= since(28) && r.intensity_factor != null && (r.duration_sec || 0) >= 900);
  if (ifRuns.length >= 4){
    const easy = ifRuns.filter(r => Number(r.intensity_factor) < 0.8).length;
    if (easy / ifRuns.length < 0.5) out.push({ key:'run-easy', sport:'run', title:'Your easy runs are too quick',
      text:(easy ? 'Only ' + easy : 'None') + ' of your ' + ifRuns.length + ' runs in the last 4 weeks ' + (easy === 1 ? 'was' : 'were') + ' at an easy pace. Slow your easy runs down so your hard runs can be harder.',
      weights: { easy:0.3, steady:-0.2 } });
  }

  // 4. A riding zone well behind the others (needs enough structured rides to say).
  const structured = bikes.filter(r => byRide[r.id] && dayOf(r) >= since(42)).length;
  if (structured >= 6){
    const lv = LEVEL_CHECK.map(z => [z, levels[z] || 1]);
    const mid = median(lv.map(x => x[1]));
    const [z, l] = lv.reduce((a, b) => b[1] < a[1] ? b : a);
    if (l <= mid - 2 && !out.some(p => p.weights && p.weights[z] > 0)) out.push({ key:'ride-behind-' + z, sport:'ride', title:'Your ' + zn(z) + ' level is behind',
      text:'Your ' + zn(z) + ' level (' + l.toFixed(1) + ') is well behind your others (around ' + mid.toFixed(1) + '). One ' + zn(z) + ' session a week will bring it up.',
      weights: { [z]: 0.35 } });
  }

  // 5. The long session the goal needs, missing.
  [['ride', guides.ride, bikes], ['run', guides.run, runs]].forEach(([sport, gd, list]) => {
    if (!gd || !gd.long) return;
    const longest = list.filter(r => dayOf(r) >= since(21)).reduce((m, r) => Math.max(m, (r.duration_sec || 0) / 60), 0);
    if (longest >= gd.long.target * 0.6) return;
    out.push({ key: sport + '-long', sport, title:'Time for a weekly long ' + sport,
      text:'Your longest ' + sport + ' in 3 weeks is ' + (longest ? hm(longest) : 'under half an hour') + '. ' + gd.phrase.charAt(0).toUpperCase() + gd.phrase.slice(1) + ' needs one long ' + sport + ' a week: we\'ll suggest it on ' + gd.long.dayName + 's.',
      weights: null });
  });

  // 6. Training less often than before.
  const days = (from, to) => new Set(past.filter(r => dayOf(r) >= from && dayOf(r) < to).map(dayOf)).size;
  const recent = days(since(14), today), before = days(since(42), since(14)) / 2;
  if (before >= 4 && recent <= before * 0.5) out.push({ key:'consistency', sport:null, title:'Training less often',
    text:'You\'ve trained on ' + recent + ' day' + (recent === 1 ? '' : 's') + ' in the last two weeks, down from about ' + Math.round(before) + '. Three shorter sessions a week build more than one long one.',
    weights: null });

  // 7. An FTP that's getting old.
  if (ftpSetAt && bikes.length){
    const age = daysBetween(isoDate(new Date(ftpSetAt)), today);
    const ridesSince = bikes.filter(r => r.started_at >= ftpSetAt).length;
    if (age >= 56 && ridesSince >= 6) out.push({ key:'ftp-old', sport:'ride', title:'Your FTP is ' + Math.floor(age / 7) + ' weeks old',
      text:'A Ramp Test would make every target, and every suggestion, fit you better.',
      weights: null, action: { label:'Take a Ramp Test', href:'live.html?load=prebuilt-ramp-test-25' } });
  }

  return out.slice(0, 3);
}

// The zone weights from the points, added up for one sport: { zone: weight }, or null.
export function focusWeights(points, sport){
  const w = {};
  (points || []).forEach(p => { if (p.sport === sport && p.weights) Object.entries(p.weights).forEach(([z, n]) => { w[z] = (w[z] || 0) + n; }); });
  return Object.keys(w).length ? w : null;
}

export function focusListHtml(points, esc){
  return '<ul class="focus-list">' + points.map(p => '<li><b>' + esc(p.title) + '</b><span>' + esc(p.text) + '</span>'
    + (p.action ? '<a class="focus-act" href="' + p.action.href + '">' + esc(p.action.label) + ' →</a>' : '') + '</li>').join('') + '</ul>';
}
export const FOCUS_CSS = `
.focus-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
.focus-list li{ display:flex; flex-direction:column; gap:2px; padding-left:14px; position:relative; }
.focus-list li::before{ content:""; position:absolute; left:0; top:7px; width:6px; height:6px; border-radius:50%; background:var(--accent, #45D6C4); }
.focus-list b{ font-size:14px; } .focus-list span{ font-size:13px; color:var(--text-dim, #8C97A6); line-height:1.45; }
.focus-act{ font-size:13px; color:var(--accent, #45D6C4); text-decoration:none; margin-top:2px; }
`;
export function ensureFocusCss(){
  if (document.getElementById('tc-focus-style')) return;
  const s = document.createElement('style'); s.id = 'tc-focus-style'; s.textContent = FOCUS_CSS; document.head.appendChild(s);
}
