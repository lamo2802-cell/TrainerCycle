// Goals for riders and runners who aren't following a plan: one running goal (a race distance and a
// target time) and one riding goal (an FTP in watts, or a long ride of some distance), each with an
// optional date. Saved in settings key `goals` as { v:{ run, ride } }. Nothing else is stored: how far
// along the rider is, and how the goal steers the suggested ride and run, are worked out from history.
//
// A goal steers the suggestion three ways (see suggest.js): a pull towards the zones it needs, a number
// of key sessions a week in those zones (once they're done the rest of the week leans easy), and for
// distance goals a long session on the rider's long day that builds about 10% a week. With both goals
// set, pickSport() says which of the two to do today. Readiness still decides how hard, and rest wins.
import { isoDate, parseIso, addDays, daysBetween } from './plan-schedule.js?v=6';
import { RUN_GOALS, predictTime, fmtDuration } from './run-plans.js?v=4';
import { fmtPace, parseDuration } from './run.js?v=8';
import { showSheet } from './sheet.js?v=3';

export const GOALS_KEY = 'goals';
const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// weights: how strongly each zone pulls (added to the suggester's zone score). key: the zones a key session is in.
// long: the minutes the long run builds towards (null: no long-run focus). keys: key sessions a week.
export const RUN_FOCUS = {
  '5k':       { weights:{ interval:0.6, threshold:0.4, fast:0.2 }, key:['interval','threshold','fast'], long:null, keys:2 },
  '10k':      { weights:{ threshold:0.6, interval:0.3 },           key:['threshold','interval'],        long:75,   keys:2 },
  'half':     { weights:{ threshold:0.4, steady:0.4 },             key:['threshold','steady'],          long:120,  keys:2 },
  'marathon': { weights:{ steady:0.6, threshold:0.2 },             key:['steady','threshold'],          long:165,  keys:2 },
};
export const RIDE_FOCUS = {
  ftp:      { weights:{ sweet_spot:0.6, threshold:0.6, vo2max:0.3 }, key:['sweet_spot','threshold','vo2max'], keys:2 },
  distance: { weights:{ endurance:0.6, tempo:0.4, sweet_spot:0.2 },  key:['tempo','sweet_spot'],              keys:1 },
};
const DEFAULT_SPEED = 25;      // km/h for a long ride when there's no outdoor riding to go on
const LONG_SHARE = 0.75;       // the long session builds to about this much of the event's time
const dayOf = r => isoDate(new Date(r.started_at));
const weekday = iso => (parseIso(iso).getDay() + 6) % 7;   // Monday 0
const mondayOf = iso => addDays(iso, -weekday(iso));
const hm = mins => { const m = Math.round(mins); return m >= 60 ? Math.floor(m/60)+' h'+(m%60 ? ' '+String(m%60).padStart(2,'0') : '') : m+' min'; };
const round = (n, step) => Math.round(n / step) * step;

export async function loadGoals(supabase, userId){
  try {
    const { data } = await supabase.from('settings').select('value').eq('user_id', userId).eq('key', GOALS_KEY).maybeSingle();
    const v = data && data.value && data.value.v;
    return { run: v && v.run && RUN_GOALS[v.run.goal] ? v.run : null, ride: v && v.ride && RIDE_FOCUS[v.ride.type] ? v.ride : null };
  } catch(_){ return { run:null, ride:null }; }
}
export async function saveGoals(supabase, userId, goals){
  const { error } = await supabase.from('settings').upsert({ user_id: userId, key: GOALS_KEY, value: { v: goals }, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
  if (error) throw error;
}

export function goalLabel(sport, g){
  if (!g) return '';
  if (sport === 'run') return RUN_GOALS[g.goal].label + (g.targetSec ? ' in ' + fmtDuration(g.targetSec) : '');
  return g.type === 'ftp' ? g.watts + ' W FTP' : g.km + ' km ride';
}
// "your 10K goal" / "your 275 W goal" / "your 100 km ride"
const goalPhrase = (sport, g) => sport === 'run' ? 'your ' + RUN_GOALS[g.goal].label + ' goal' : g.type === 'ftp' ? 'your ' + g.watts + ' W goal' : 'your ' + g.km + ' km ride';
const weeksTo = date => date ? Math.max(0, daysBetween(isoDate(new Date()), date) / 7) : null;

// Outdoor riding speed (km/h) from rides with a distance, the middle one, or null.
function outdoorSpeed(rides){
  const v = rides.filter(r => (r.sport || 'ride') === 'ride' && r.distance_m > 5000 && r.duration_sec >= 1800)
    .map(r => r.distance_m / 1000 / (r.duration_sec / 3600)).filter(s => s > 10 && s < 45).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}
// How long the rider's distance goal should take them, in minutes.
export function eventMinutes(g, rides){
  const speed = outdoorSpeed(rides) || DEFAULT_SPEED;
  return { mins: Math.round(g.km / speed * 60 / 5) * 5, speed: Math.round(speed * 10) / 10, measured: !!outdoorSpeed(rides) };
}

// ---- Progress: where the rider is against the goal ----
// state: 'there' (already at it) | 'on-track' | 'stretch' | 'open' (no date) | 'unknown' (nothing to measure yet)
export function runGoalStatus(g, T){
  const goal = RUN_GOALS[g.goal];
  const pred = predictTime(g.goal, T);
  const needT = g.targetSec ? Math.round(g.targetSec * goal.speed / goal.km) : null;
  const weeks = weeksTo(g.date);
  if (!pred || !g.targetSec) return { state:'unknown', pred, needT, weeks,
    text: T ? 'Add a target time to see how far off it you are.' : 'Set your threshold pace in TrainerRun (or log a hard run) and we\'ll predict your time.' };
  const gap = pred / g.targetSec - 1;   // above 0: slower than the target
  if (gap <= 0) return { state:'there', pred, needT, weeks, gap, text:'Your predicted ' + goal.label + ' is ' + fmtDuration(pred) + ', inside your target. Keep the key sessions coming to hold it.' };
  const base = 'Predicted ' + fmtDuration(pred) + ' today. ' + fmtDuration(g.targetSec) + ' needs a threshold pace of ' + fmtPace(needT) + ' /km (you\'re at ' + fmtPace(T) + ').';
  if (weeks == null) return { state:'open', pred, needT, weeks, gap, text: base };
  // About 1% faster a week is a fair ceiling for a few months; beyond that it's a stretch.
  const perWeek = weeks ? gap * 100 / weeks : Infinity;
  return { state: perWeek <= 1 ? 'on-track' : 'stretch', pred, needT, weeks, gap,
    text: base + (perWeek <= 1 ? ' That\'s a realistic gain by race day.' : ' That\'s a big step for ' + Math.round(weeks) + ' weeks, so treat it as a stretch.') };
}
export function rideGoalStatus(g, { ftp, estFtp, rides }){
  const weeks = weeksTo(g.date);
  if (g.type === 'ftp'){
    const cur = Math.max(ftp || 0, estFtp || 0);
    if (!cur) return { state:'unknown', weeks, text:'Set your FTP (a Ramp Test takes about 20 minutes) to track this.' };
    const gap = g.watts / cur - 1;
    if (gap <= 0) return { state:'there', cur, weeks, gap, text:'Your FTP is ' + cur + ' W: you\'ve reached it. Time for a new target?' };
    const base = (g.watts - cur) + ' W to go from ' + cur + ' W' + (estFtp > (ftp || 0) ? ' (detected from your rides)' : '') + '.';
    if (weeks == null) return { state:'open', cur, weeks, gap, text: base };
    const perWeek = weeks ? gap * 100 / weeks : Infinity;
    return { state: perWeek <= 1 ? 'on-track' : 'stretch', cur, weeks, gap,
      text: base + (perWeek <= 1 ? ' A realistic gain in ' + Math.round(weeks) + ' weeks.' : ' That\'s more than about 1% a week, so treat it as a stretch.') };
  }
  const ev = eventMinutes(g, rides);
  const since = addDays(isoDate(new Date()), -42);
  const longest = rides.filter(r => (r.sport || 'ride') === 'ride' && dayOf(r) >= since).reduce((m, r) => Math.max(m, (r.duration_sec || 0) / 60), 0);
  const ready = longest >= ev.mins * LONG_SHARE;
  return { state: ready ? 'there' : weeks == null ? 'open' : 'on-track', longest, eventMins: ev.mins, weeks,
    text: g.km + ' km is about ' + hm(ev.mins) + ' at ' + (ev.measured ? 'your outdoor speed (' + ev.speed + ' km/h)' : DEFAULT_SPEED + ' km/h') + '. '
      + (longest ? 'Your longest ride in 6 weeks is ' + hm(longest) + (ready ? ': you\'re ready for it.' : '; your long ride builds towards ' + hm(ev.mins * LONG_SHARE) + '.') : 'A weekly long ride will build you up to it.') };
}

// ---- Guidance: what the suggesters use ----
// The rider's long day for a sport: the weekday their longest session of the week most often lands on.
function longDayOf(list, fallback){
  const byWeek = new Map();
  list.forEach(r => { const w = mondayOf(dayOf(r)); const b = byWeek.get(w); if (!b || r.duration_sec > b.duration_sec) byWeek.set(w, r); });
  const n = [0,0,0,0,0,0,0];
  byWeek.forEach(r => { n[weekday(dayOf(r))]++; });
  const top = n.indexOf(Math.max(...n));
  return n[top] >= 2 ? top : fallback;
}
// A long session today: on the long day, or on Sunday if the long day went by without one.
function longToday(day, today, done){
  if (done) return false;
  const wd = weekday(today);
  return wd === day || (wd === 6 && day < 6);
}

// sport 'ride' | 'run'. zoneOf(r): the zone a session counted in (byRide / byRun), or null.
// Returns null without a goal, else { sport, label, phrase, weights, key, keys, keyDone, keyLeft, long, note }.
//   long: null or { mins, target, today, day } — the long session to do and what it builds towards.
//   note: an extra sentence for the reason line (pace needed for a run goal).
export function goalGuide(sport, g, { rides, zoneOf, today, runPace = null }){
  if (!g) return null;
  const focus = sport === 'run' ? RUN_FOCUS[g.goal] : RIDE_FOCUS[g.type];
  if (!focus) return null;
  const mine = rides.filter(r => sport === 'run' ? r.sport === 'run' : (r.sport || 'ride') === 'ride');
  const mon = mondayOf(today);
  const week = mine.filter(r => dayOf(r) >= mon && dayOf(r) < today);
  const keyDone = week.filter(r => focus.key.includes(zoneOf(r))).length;
  let long = null;
  const target = sport === 'run' ? focus.long : g.type === 'distance' ? Math.round(eventMinutes(g, rides).mins * LONG_SHARE) : null;
  if (target){
    const recent = mine.filter(r => dayOf(r) >= addDays(today, -21) && dayOf(r) < today);
    const longest = recent.reduce((m, r) => Math.max(m, (r.duration_sec || 0) / 60), 0);
    const base = longest || (sport === 'run' ? 40 : 90);
    const mins = Math.min(target, round(Math.max(base * 1.1, base + 10), sport === 'run' ? 5 : 15));
    const day = longDayOf(mine.filter(r => dayOf(r) >= addDays(today, -42)), sport === 'run' ? 6 : 5);
    const done = week.some(r => (r.duration_sec || 0) / 60 >= Math.min(mins, target) * 0.85);
    long = { mins: Math.max(mins, sport === 'run' ? 30 : 60), target, day, dayName: DAY_NAMES[day], done, today: longToday(day, today, done) };
  }
  let note = '';
  if (sport === 'run' && g.targetSec){
    const st = runGoalStatus(g, runPace);
    if (st.pred && st.needT) note = st.state === 'there' ? 'Your predicted ' + RUN_GOALS[g.goal].label + ' (' + fmtDuration(st.pred) + ') is already inside your target.'
      : 'Your ' + RUN_GOALS[g.goal].label + ' goal of ' + fmtDuration(g.targetSec) + ' needs ' + fmtPace(st.needT) + ' /km threshold pace; today\'s prediction is ' + fmtDuration(st.pred) + '.';
  }
  return { sport, goal: g, label: goalLabel(sport, g), phrase: goalPhrase(sport, g), weights: focus.weights, key: focus.key, keys: focus.keys,
    keyDone, keyLeft: Math.max(0, focus.keys - keyDone), long, note, weeks: weeksTo(g.date) };
}

// Both sports' guidance at once. rideZone(r, byRide): the zone a ride counted in (suggest.js).
export function guidesFor({ goals, rides, byRide = {}, byRun = {}, today, runPace = null, rideZone }){
  if (!goals) return { ride:null, run:null };
  return {
    ride: goalGuide('ride', goals.ride, { rides, zoneOf: r => rideZone(r, byRide), today }),
    run: goalGuide('run', goals.run, { rides, zoneOf: r => byRun[r.id] ? byRun[r.id].zone : null, today, runPace }),
  };
}

// The goal's pull on a zone in the suggester's zone score: towards the goal's zones while key sessions
// are owed, and away from hard zones once they're done so the rest of the week stays easy.
export function goalPull(guide, zone, hardZones){
  if (!guide) return 0;
  if (guide.keyLeft > 0) return guide.weights[zone] || 0;
  return hardZones.has(zone) ? -0.4 : 0;
}
// The sentence the goal adds to the suggestion's reason.
export function goalReason(guide, zone, { long = false } = {}){
  if (!guide) return '';
  if (long) return 'It\'s your long ' + (guide.sport === 'run' ? 'run' : 'ride') + ' for ' + guide.phrase + ', building towards ' + hm(guide.long.target) + '.';
  if (guide.key.includes(zone) && guide.keyLeft > 0)
    return 'Key session ' + (guide.keyDone + 1) + ' of ' + guide.keys + ' this week for ' + guide.phrase + '.' + (guide.note ? ' ' + guide.note : '');
  if (guide.keyLeft > 0 && (guide.weights[zone] || 0) >= 0.4) return 'That\'s the kind of ' + (guide.sport === 'run' ? 'running' : 'riding') + ' ' + guide.phrase + ' needs.' + (guide.note ? ' ' + guide.note : '');
  if (guide.keyLeft === 0) return 'Your key session' + (guide.keys > 1 ? 's' : '') + ' for ' + guide.phrase + (guide.keys > 1 ? ' are' : ' is') + ' done this week, so the rest stay easy.';
  return guide.note || '';
}

// ---- Ride or run today ----
// With goals in both sports (or a running goal and some running), which to do today for the most overall
// gain: the sport owed more key sessions, the goal with less time left, the sport whose long day it is,
// and the one left longest, with running held back after hard or long running (an easy ride recovers the
// legs better) and when tired. Returns { sport, reason } or null when there's nothing to choose between.
export function pickSport({ rideGuide, runGuide, rides, byRun = {}, band, beginner = false, today }){
  if (!runGuide && !rideGuide) return null;
  const last = sport => rides.filter(r => (sport === 'run' ? r.sport === 'run' : (r.sport || 'ride') === 'ride') && dayOf(r) < today).map(dayOf).sort().pop();
  const since = sport => { const d = last(sport); return d ? daysBetween(d, today) : 14; };
  const f = { ride: [], run: [] };   // [score, reason]
  const add = (sport, n, why) => f[sport].push([n, why]);
  [['ride', rideGuide], ['run', runGuide]].forEach(([sport, gd]) => {
    if (!gd) return;
    if (gd.long && gd.long.today && band >= 2) add(sport, 1.5, 'it\'s your long ' + sport + ' day for ' + gd.phrase);
    if (gd.keyLeft) add(sport, gd.keyLeft / gd.keys, 'you still have ' + (gd.keyLeft === 1 ? 'a key session' : gd.keyLeft + ' key sessions') + ' this week for ' + gd.phrase);
    if (gd.weeks != null && gd.weeks <= 16) add(sport, gd.weeks <= 8 ? 0.5 : 0.25, gd.phrase.replace('your ', 'your ') + ' is ' + Math.max(1, Math.round(gd.weeks)) + ' week' + (Math.round(gd.weeks) === 1 ? '' : 's') + ' away');
  });
  ['ride', 'run'].forEach(sport => { const d = since(sport); if (d >= 2) add(sport, Math.min(d, 7) / 7 * 0.6, 'you haven\'t ' + (sport === 'run' ? 'run' : 'ridden') + ' for ' + d + ' days'); });
  const runs = rides.filter(r => r.sport === 'run' && dayOf(r) < today && dayOf(r) >= addDays(today, -2));
  const hardRun = runs.find(r => byRun[r.id] && byRun[r.id].zone !== 'easy');
  const longRun = runs.find(r => dayOf(r) === addDays(today, -1) && (r.duration_sec || 0) >= 75 * 60);
  if (hardRun) add('run', -1, 'you ran hard ' + (dayOf(hardRun) === addDays(today, -1) ? 'yesterday' : '2 days ago') + ', and the bike gives your legs a break');
  else if (longRun) add('run', -1, 'you ran long yesterday, and an easy ride recovers your legs better than another run');
  else if (runs.some(r => dayOf(r) === addDays(today, -1))) add('run', -0.3, 'you ran yesterday');
  if (band <= 1) add('run', -0.7, 'you\'re tired, and an easy ride is gentler on your legs than a run');
  if (beginner && runs.length) add('run', -1, 'walk/run works best with a day or two between');
  const sum = s => f[s].reduce((a, [n]) => a + n, 0);
  const sport = sum('run') > sum('ride') ? 'run' : 'ride';
  const other = sport === 'run' ? 'ride' : 'run';
  // Name the strongest reason for the pick, or the strongest reason against the other.
  const pros = f[sport].filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]);
  const cons = f[other].filter(([n]) => n < 0).sort((a, b) => a[0] - b[0]);
  const why = cons.length && (!pros.length || -cons[0][0] >= pros[0][0]) ? cons[0][1] : pros.length ? pros[0][1] : '';
  return { sport, reason: (sport === 'run' ? 'Run today' : 'Ride today') + (why ? ': ' + why + '.' : '.') };
}

// ---- The goals card and the set-goal sheet ----
const STATE_WORD = { there:'Reached', 'on-track':'On track', stretch:'Stretch', open:'In progress', unknown:'Set up' };
// One row per goal, plus a button to add the missing one. statuses: { run, ride } from the *GoalStatus functions.
export function goalsCardHtml(goals, statuses, esc){
  const row = (sport, g, st) => '<div class="goal-row" data-goal-edit="'+sport+'"><span class="goal-sport">'+(sport === 'run' ? 'Run' : 'Ride')+'</span>'
    + '<div class="goal-body"><b>'+esc(goalLabel(sport, g))+(g.date ? ' · '+parseIso(g.date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year: g.date.slice(0,4) === String(new Date().getFullYear()) ? undefined : 'numeric' }) : '')+'</b>'
    + '<p>'+esc(st.text)+'</p></div><span class="goal-state s-'+st.state+'">'+STATE_WORD[st.state]+'</span></div>';
  const rows = [goals.run ? row('run', goals.run, statuses.run) : '', goals.ride ? row('ride', goals.ride, statuses.ride) : ''].join('');
  const add = [!goals.ride ? '<button class="link-btn" data-goal-edit="ride">+ Riding goal</button>' : '', !goals.run ? '<button class="link-btn" data-goal-edit="run">+ Running goal</button>' : ''].join('');
  return rows ? '<div class="goal-rows">'+rows+'</div>'+(add ? '<div class="goal-add">'+add+'</div>' : '')
    : '<p class="goal-empty">Set a goal and your suggested rides and runs work towards it: a race time, an FTP, or a long ride.</p><div class="goal-add">'+add+'</div>';
}
export const GOALS_CSS = `
.goal-rows{ display:flex; flex-direction:column; gap:2px; }
.goal-row{ display:grid; grid-template-columns:44px 1fr auto; gap:10px; align-items:start; padding:10px 0; border-top:1px solid var(--line, #2A323D); cursor:pointer; }
.goal-row:first-child{ border-top:0; padding-top:2px; }
.goal-sport{ font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-dim, #8C97A6); padding-top:2px; }
.goal-body{ min-width:0; } .goal-body b{ font-size:14.5px; } .goal-body p{ margin:3px 0 0; font-size:13px; line-height:1.45; color:var(--text-dim, #8C97A6); }
.goal-state{ font-size:11.5px; font-weight:600; padding:3px 8px; border-radius:99px; border:1px solid currentColor; white-space:nowrap; color:var(--text-dim, #8C97A6); }
.goal-state.s-there, .goal-state.s-on-track{ color:#3DBE7A; } .goal-state.s-stretch{ color:#E8B93D; }
.goal-add{ display:flex; gap:16px; flex-wrap:wrap; margin-top:8px; }
.goal-empty{ margin:0 0 4px; font-size:13.5px; color:var(--text-dim, #8C97A6); line-height:1.5; }
.gs-form{ display:flex; flex-direction:column; gap:12px; margin:6px 0 2px; }
.gs-form label{ display:flex; flex-direction:column; gap:5px; font-size:12.5px; color:#B4BDC9; }
.gs-form input{ padding:10px 12px; border-radius:9px; border:1px solid #2A323D; background:#0F1318; color:#E7ECF2; font:inherit; font-size:15px; }
.gs-seg{ display:flex; flex-wrap:wrap; gap:6px; }
.gs-seg button{ flex:1; min-width:64px; padding:9px 8px; border-radius:9px; border:1px solid #2A323D; background:#1D242D; color:#E7ECF2; font:inherit; font-size:13.5px; font-weight:600; cursor:pointer; }
.gs-seg button.on{ background:rgba(69,214,196,.16); border-color:#45D6C4; color:#45D6C4; }
.gs-err{ color:#FF8A8D; font-size:13px; min-height:1em; }
`;
export function ensureGoalsCss(){
  if (document.getElementById('tc-goals-style')) return;
  const s = document.createElement('style'); s.id = 'tc-goals-style'; s.textContent = GOALS_CSS; document.head.appendChild(s);
}

// Opens the sheet to set (or change, or remove) a goal. Resolves with the new goals, or null if nothing changed.
// ctx: { ftp, runPace } to prefill sensible targets.
export async function openGoalSheet(supabase, userId, goals, sport, ctx = {}){
  ensureGoalsCss();
  const cur = goals[sport];
  const form = document.createElement('div');
  form.className = 'gs-form';
  const today = isoDate(new Date());
  let kind = sport === 'run' ? (cur ? cur.goal : '10k') : (cur ? cur.type : 'ftp');
  function draw(){
    const seg = (opts) => '<div class="gs-seg" role="group">'+opts.map(([k, t]) => '<button type="button" data-k="'+k+'" class="'+(k === kind ? 'on' : '')+'" aria-pressed="'+(k === kind)+'">'+t+'</button>').join('')+'</div>';
    const date = '<label for="gsDate">Date (optional: a race or event day)<input type="date" id="gsDate" min="'+addDays(today, 7)+'" value="'+((cur && cur.date) || '')+'"></label>';
    if (sport === 'run'){
      const pred = predictTime(kind, ctx.runPace);
      const sameGoal = cur && cur.goal === kind;
      form.innerHTML = seg(Object.entries(RUN_GOALS).map(([k, g]) => [k, g.label]))
        + '<label for="gsTime">Target time (h:mm:ss or mm:ss)<input type="text" id="gsTime" inputmode="numeric" placeholder="'+(pred ? fmtDuration(Math.round(pred * 0.97)) : kind === '5k' ? '25:00' : kind === '10k' ? '52:00' : kind === 'half' ? '1:55:00' : '4:00:00')+'" value="'+(sameGoal && cur.targetSec ? fmtDuration(cur.targetSec) : '')+'"></label>'
        + (pred ? '<p style="margin:0;font-size:12.5px;color:#8B95A3">Your predicted '+RUN_GOALS[kind].label+' today: '+fmtDuration(pred)+'.</p>' : '')
        + date + '<div class="gs-err" id="gsErr"></div>';
    } else {
      form.innerHTML = seg([['ftp', 'FTP'], ['distance', 'Distance']])
        + (kind === 'ftp'
          ? '<label for="gsVal">Target FTP (watts)<input type="number" id="gsVal" inputmode="numeric" min="50" max="600" placeholder="'+(ctx.ftp ? Math.round(ctx.ftp * 1.08 / 5) * 5 : 250)+'" value="'+(cur && cur.type === 'ftp' ? cur.watts : '')+'"></label>'
            + (ctx.ftp ? '<p style="margin:0;font-size:12.5px;color:#8B95A3">Your FTP is '+Math.round(ctx.ftp)+' W.</p>' : '')
          : '<label for="gsVal">One ride of (km)<input type="number" id="gsVal" inputmode="numeric" min="20" max="400" placeholder="100" value="'+(cur && cur.type === 'distance' ? cur.km : '')+'"></label>'
            + '<p style="margin:0;font-size:12.5px;color:#8B95A3">For a sportive or a big day out. Your long ride builds towards it each week.</p>')
        + date + '<div class="gs-err" id="gsErr"></div>';
    }
  }
  form.addEventListener('click', e => {
    const b = e.target.closest('.gs-seg button'); if (!b) return;
    kind = b.dataset.k; draw();
  });
  draw();
  let result = null;
  const buttons = [{ label:'Save goal', value:'save', kind:'primary' }].concat(cur ? [{ label:'Remove goal', value:'remove' }] : [], [{ label:'Cancel', value:null }]);
  const read = () => {
    const err = form.querySelector('#gsErr');
    const date = (form.querySelector('#gsDate') || {}).value || null;
    if (sport === 'run'){
      const raw = form.querySelector('#gsTime').value.trim();
      const t = raw ? parseDuration(raw) : null;
      if (raw && !t){ err.textContent = 'Enter a time like 45:00 or 1:52:30.'; return null; }
      if (t && t < RUN_GOALS[kind].km * 150){ err.textContent = 'That\'s faster than the world record. Check the time.'; return null; }
      return { goal: kind, targetSec: t || null, date };
    }
    const v = Number(form.querySelector('#gsVal').value);
    if (kind === 'ftp'){ if (!(v >= 50 && v <= 600)){ err.textContent = 'Enter a target FTP in watts, e.g. 275.'; return null; } return { type:'ftp', watts: Math.round(v), date }; }
    if (!(v >= 20 && v <= 400)){ err.textContent = 'Enter a distance in km, e.g. 100.'; return null; }
    return { type:'distance', km: Math.round(v), date };
  };
  const choice = await showSheet({ title: (cur ? 'Change your ' : 'Set a ') + (sport === 'run' ? 'running goal' : 'riding goal'),
    text: sport === 'run' ? 'Pick a race distance and the time you\'re after. Your suggested runs will lean towards the sessions it needs.' : 'Aim for a higher FTP, or build up to one long ride. Your suggested rides will lean towards it.',
    content: form, buttons, dismissValue: null,
    onAction: async v => {
      const next = Object.assign({}, goals);
      if (v === 'remove') next[sport] = null;
      else { const g = read(); if (!g) return false; next[sport] = g; }
      try { await saveGoals(supabase, userId, next); } catch(_){ form.querySelector('#gsErr').textContent = 'Couldn\'t save. Check your connection and try again.'; return false; }
      result = next;
      return true;
    } });
  return choice ? result : null;
}
