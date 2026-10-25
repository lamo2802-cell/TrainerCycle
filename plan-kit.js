// Plans people build themselves (plan-builder.html), and the triathlon and duathlon plans that start them off.
//
// A built plan is a training_plans row owned by the rider (source 'builder'), so it is followed like any other
// plan. Its days can hold any sport:
//   ride      { type:'workout', workoutType:'cycling', workoutId:<library workout> }
//   strength  { type:'workout', workoutType:'strength', workoutId:<strength workout> }
//   run       { type:'workout', workoutType:'run', workoutId, session:{ name, kind, steps, blurb } }
//   swim      { type:'workout', workoutType:'swim', workoutId, session:{ name, kind, steps, blurb } }
//   brick     { type:'workout', workoutType:'brick', workoutId:<library workout>, runId, session:<run spec> }
//   race      { type:'workout', workoutType:'race', workoutId, race:{ name, mins, tss, text } }
// Run and swim sessions are written into the plan itself (their makers are below) and registered with
// run.js and swim.js when the plan is loaded, so every page reads them like any other session.
import { registerRunSession, runSession, runLoad, plannedRunTss } from './run.js?v=5';
import { registerSwimSession, swimSession } from './swim.js?v=2';
import { plannedTss, parseIso, addDays, todayIso, mondayOnOrAfter } from './plan-schedule.js?v=3';

export const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const RACES_BY_ID = {};

// ---- sessions ----

const r5 = m => Math.max(10, Math.round(m/5)*5);
const r50 = m => Math.max(50, Math.round(m/50)*50);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const RUN_TYPES = [
  { id:'easy',      label:'Easy run' },
  { id:'long',      label:'Long run' },
  { id:'strides',   label:'Easy run + strides' },
  { id:'tempo',     label:'Tempo run' },
  { id:'intervals', label:'Intervals' },
  { id:'hills',     label:'Hill reps' },
  { id:'brick',     label:'Run off the bike' },
];
// type + minutes -> a run spec for run.js
export function makeRun(type, mins){
  mins = r5(mins || 40);
  const wu = { mins:10, zone:'easy' }, cd = { mins:10, zone:'easy' };
  switch (type){
    case 'long': return { name:'Long run', kind:'long', blurb:'Keep it easy enough that the last 10 minutes feel as controlled as the first.', steps:[{ mins, zone:'easy' }] };
    case 'strides': return { name:'Easy run + strides', kind:'easy', blurb:'Strides are quick and relaxed, not sprints.', steps:[{ mins: Math.max(10, mins-6), zone:'easy' }, { reps:6, secs:20, zone:'fast', rec:{ secs:60, kind:'walk' } }] };
    case 'tempo': { const t = clamp(r5((mins-20)*0.8), 10, 40); return { name:'Tempo run', kind:'quality', blurb:'One steady block at threshold. Even pace, no surging.', steps:[wu, { mins:t, zone:'threshold' }, { mins: Math.max(5, mins-10-t), zone:'easy' }] }; }
    case 'intervals': { const n = clamp(Math.floor((mins-20)/5), 3, 8); return { name:'Intervals '+n+' × 3 min', kind:'quality', steps:[wu, { reps:n, mins:3, zone:'interval', rec:{ mins:2, kind:'jog' } }, cd] }; }
    case 'hills': { const n = clamp(Math.floor((mins-20)/2.5), 4, 12); return { name:'Hill reps', kind:'quality', blurb:'On a steady hill: run up hard and tall, jog back down.', steps:[wu, { reps:n, secs:60, zone:'interval', rec:{ secs:90, kind:'jog' } }, cd] }; }
    case 'brick': return { name:'Run off the bike', kind:'brick', blurb:'Straight off the bike. Short, quick steps for the first few minutes while your legs adjust, then settle into a steady effort.', steps:[{ mins, zone:'steady' }] };
    default: return { name:'Easy run', kind:'easy', blurb:'Conversational pace the whole way.', steps:[{ mins, zone:'easy' }] };
  }
}
export function runTypeOf(spec){
  if (!spec) return 'easy';
  if (spec.kind === 'brick') return 'brick';
  if (spec.kind === 'long') return 'long';
  const n = spec.name || '';
  return /strides/i.test(n) ? 'strides' : /tempo/i.test(n) ? 'tempo' : /interval/i.test(n) ? 'intervals' : /hill/i.test(n) ? 'hills' : spec.kind === 'quality' ? 'tempo' : 'easy';
}
export function runMinsOf(spec){ return spec ? Math.round(runLoad(spec).secs/60) : 0; }

export const SWIM_TYPES = [
  { id:'easy',      label:'Easy swim' },
  { id:'technique', label:'Technique' },
  { id:'endurance', label:'Endurance' },
  { id:'css',       label:'CSS intervals' },
  { id:'speed',     label:'Speed' },
  { id:'openwater', label:'Open water' },
  { id:'test',      label:'CSS test' },
];
// type + metres -> a swim spec for swim.js
export function makeSwim(type, metres){
  metres = r50(metres || 1500);
  const wu = { m: metres >= 1500 ? 300 : 200, zone:'easy' }, cd = { m:200, zone:'easy' };
  const main = Math.max(100, metres - wu.m - cd.m);
  switch (type){
    case 'technique': { const d = Math.min(400, r50(main/2)); return { name:'Technique swim', kind:'easy', blurb:'Pick two drills you know, such as catch-up or fingertip drag. Quality strokes over speed.',
      steps:[wu, { reps: d/50, m:50, zone:'drill', what:'drill', rest:15 }, { reps: Math.max(1, Math.round((main-d)/100)), m:100, zone:'steady', rest:15 }, cd] }; }
    case 'endurance': return { name:'Endurance swim', kind:'endurance', blurb:'Hold the same pace on every rep.',
      steps:[wu, { reps: Math.max(2, Math.round(main/200)), m:200, zone:'steady', rest:20 }, cd] };
    case 'css': { const b = main >= 800 ? 200 : 0; return { name:'CSS intervals', kind:'quality', blurb:'Your threshold swim. Aim for the same time on every 100.',
      steps:[wu].concat(b ? [{ reps:4, m:50, zone:'fast', what:'build', rest:15 }] : [], [{ reps: Math.max(3, Math.round((main-b)/100)), m:100, zone:'css', rest:15 }, cd]) }; }
    case 'speed': { const d = main >= 800 ? 200 : 0; return { name:'Speed swim', kind:'quality', blurb:'Fast but long. Plenty of rest so every rep has good form.',
      steps:[wu].concat(d ? [{ reps:4, m:50, zone:'drill', what:'drill', rest:15 }] : [], [{ reps: Math.max(4, Math.round((main-d)/50)), m:50, zone:'fast', rest:30 }, cd]) }; }
    case 'openwater': return { name:'Open water swim', kind:'endurance', blurb:'Sight every 6 to 8 strokes, and practise a few fast starts. Never swim open water alone.',
      steps:[{ m:metres, zone:'steady' }] };
    case 'test': return { name:'CSS test', kind:'test', blurb:'Swim 400 m as fast as you can hold evenly, swim easy for 5 minutes, then 200 m all out. Put both times into Settings to set your CSS.',
      steps:[{ m:400, zone:'easy' }, { reps:4, m:50, zone:'fast', what:'build', rest:20 }, { m:400, zone:'fast' }, { m:200, zone:'easy' }, { m:200, zone:'fast' }, { m:200, zone:'easy' }] };
    default: return { name:'Easy swim', kind:'easy', blurb:'Relaxed and smooth. Mix in some backstroke if you like.', steps:[wu, { m:main, zone:'easy' }, cd] };
  }
}
export function swimTypeOf(spec){
  const n = (spec && spec.name) || '';
  return /technique/i.test(n) ? 'technique' : /endurance/i.test(n) ? 'endurance' : /css test/i.test(n) ? 'test' : /css/i.test(n) ? 'css' : /speed/i.test(n) ? 'speed' : /open water/i.test(n) ? 'openwater' : 'easy';
}
export function swimMetresOf(spec){ return (spec && spec.steps || []).reduce((a, s) => a + s.m * (s.reps || 1), 0); }

// Session ids follow the session's place in the plan, so a saved plan keeps them stable.
export function assignSessionIds(plan, planId){
  (plan.weeks || []).forEach((w, wi) => (w.days || []).forEach((d, di) => {
    if (!d || d.type !== 'workout') return;
    const id = planId+'-w'+(wi+1)+'-d'+di;
    if (d.workoutType === 'run' || d.workoutType === 'swim' || d.workoutType === 'race') d.workoutId = id;
    if (d.workoutType === 'brick') d.runId = id+'-run';
  }));
  return plan;
}
// Make a plan's own run and swim sessions known to run.js and swim.js. Safe to call more than once.
export function registerPlanSessions(plan){
  (plan && plan.weeks || []).forEach(w => (w.days || []).forEach(d => {
    if (!d || d.type !== 'workout') return;
    if (d.workoutType === 'run' && d.session) registerRunSession(d.workoutId, d.session);
    else if (d.workoutType === 'swim' && d.session) registerSwimSession(d.workoutId, d.session);
    else if (d.workoutType === 'brick' && d.session && d.runId) registerRunSession(d.runId, d.session);
    else if (d.workoutType === 'race' && d.race) RACES_BY_ID[d.workoutId] = d.race;
  }));
  return plan;
}
export function raceSession(id){ return RACES_BY_ID[id] || null; }

function durationOf(w){
  if (!w) return 0;
  if (w.duration_sec) return w.duration_sec;
  let t = 0;
  (function walk(list, n){ for (const s of list || []){ if (s.type === 'repeat') walk(s.steps, s.repetitions || 0); else t += (s.duration || 0) * n; } })(w.steps, 1);
  return t;
}
export { durationOf };

// One way for every page to read a plan day: what it is, how long, its planned TSS and a short description.
// workouts: id -> library or strength workout. Returns null for rest days.
// { kind:'ride'|'strength'|'run'|'swim'|'brick'|'race', name, durationSec, tss, steps?, run?, swim?, brickRun?, text?, category }
export function sessionInfo(d, workouts, ftp){
  if (!d || d.type !== 'workout') return null;
  const t = d.workoutType || 'cycling';
  if (t === 'run'){
    const run = runSession(d.workoutId);
    return { kind:'run', name: run ? run.name : 'Run', durationSec: run ? run.mins*60 : null, tss: run ? run.tss : null, run, text: run && run.text, category:'run' };
  }
  if (t === 'swim'){
    const swim = swimSession(d.workoutId);
    return { kind:'swim', name: swim ? swim.name : 'Swim', durationSec: swim ? swim.mins*60 : null, tss: swim ? swim.tss : null, swim, metres: swim && swim.metres, text: swim && swim.text, category:'swim' };
  }
  if (t === 'race'){
    const r = d.race || raceSession(d.workoutId) || {};
    return { kind:'race', name: r.name || 'Race day', durationSec: r.mins ? r.mins*60 : null, tss: r.tss || null, text: r.text || '', category:'race' };
  }
  const w = workouts[d.workoutId] || {};
  if (t === 'strength') return { kind:'strength', name: w.name || d.workoutId, durationSec: null, tss: null, category:'strength' };
  const rideTss = w.steps ? plannedTss(w.steps, ftp || 200) : null;
  if (t === 'brick'){
    const run = d.runId ? runSession(d.runId) : null;
    return { kind:'brick', name: (w.name || d.workoutId) + (run ? ' + '+run.mins+' min run' : ''), rideName: w.name || d.workoutId,
      durationSec: durationOf(w) + (run ? run.mins*60 : 0), tss: (rideTss || 0) + (run ? run.tss : 0) || null, steps: w.steps, brickRun: run,
      text: run ? 'Brick: ride, then go straight out for the run. '+run.text : '', category: w.category || 'endurance' };
  }
  return { kind:'ride', name: w.name || d.workoutId, durationSec: durationOf(w) || null, tss: rideTss, steps: w.steps, category: w.category };
}
// Days Live Ride can load: rides and the ride half of a brick.
export function isBikeDay(d){ return !d.workoutType || d.workoutType === 'cycling' || d.workoutType === 'brick'; }
export const SPORT_COLOR = { run:'#C084FC', swim:'#38BDF8', race:'#F472B6', brick:'#3DBE7A' };

// ---- picking rides from the library ----

const BIKE_CATS = {
  easy: ['endurance'], recovery: ['recovery'], long: ['endurance'],
  tempo: ['tempo', 'sweet_spot'], sweetspot: ['sweet_spot'], threshold: ['threshold', 'over_under'], vo2: ['vo2max'],
};
// The library workout of the right kind closest to `mins` long. Skips tests and anything with no steps.
export function pickRide(library, kind, mins, avoid){
  const cats = BIKE_CATS[kind] || ['endurance'];
  let best = null;
  for (const w of library){
    if (!w.steps || !cats.includes(w.category) || w.user_id) continue;
    const d = durationOf(w) / 60;
    if (!d) continue;
    const score = Math.abs(d - mins) + (avoid && avoid.has(w.id) ? 15 : 0) + cats.indexOf(w.category) * 3;
    if (!best || score < best.score) best = { w, score };
  }
  return best ? best.w.id : null;
}

// ---- triathlon and duathlon plans ----

export const MULTI_RACES = [
  { id:'tri-sprint',  sport:'tri', label:'Sprint triathlon',   short:'Sprint tri',   legs:'750 m swim · 20 km bike · 5 km run',      weeks:10, taper:1, mins:85,
    swim:[1000, 1600], longRide:[50, 80], qRide:[45, 60], longRun:[30, 50], qRun:[30, 40], brickRun:[10, 20] },
  { id:'tri-olympic', sport:'tri', label:'Olympic triathlon',  short:'Olympic tri',  legs:'1.5 km swim · 40 km bike · 10 km run',    weeks:12, taper:2, mins:160,
    swim:[1400, 2400], longRide:[70, 120], qRide:[50, 70], longRun:[45, 75], qRun:[35, 50], brickRun:[15, 25] },
  { id:'tri-703',     sport:'tri', label:'Half Ironman (70.3)', short:'70.3',        legs:'1.9 km swim · 90 km bike · 21.1 km run',  weeks:16, taper:2, mins:330,
    swim:[1800, 3000], longRide:[90, 190], qRide:[60, 90], longRun:[60, 105], qRun:[40, 60], brickRun:[20, 40] },
  { id:'du-sprint',   sport:'du',  label:'Sprint duathlon',    short:'Sprint du',    legs:'5 km run · 20 km bike · 2.5 km run',      weeks:8,  taper:1, mins:80,
    longRide:[50, 80], qRide:[45, 60], longRun:[35, 55], qRun:[30, 45], brickRun:[10, 20] },
  { id:'du-standard', sport:'du',  label:'Standard duathlon',  short:'Standard du',  legs:'10 km run · 40 km bike · 5 km run',       weeks:10, taper:1, mins:150,
    longRide:[70, 120], qRide:[50, 70], longRun:[50, 80], qRun:[35, 50], brickRun:[15, 25] },
];
MULTI_RACES.forEach(r => { RACES_BY_ID[r.id] = r; });
export const MULTI_LEVELS = [
  { id:'new', label:'First one', text:'New to the sport, or it\'s your first race at this distance.', k:0.8 },
  { id:'regular', label:'Done a few', text:'You train most weeks and have raced before.', k:1 },
  { id:'experienced', label:'Experienced', text:'Comfortable with hard sessions and bigger weeks.', k:1.15 },
];

// The sessions each week, most important first. With fewer training days the ones at the end drop off.
const WEEK_SLOTS = {
  tri: ['longRide', 'longRun', 'swimMain', 'qRide', 'swim2', 'qRun', 'swim3'],
  du:  ['longRide', 'longRun', 'qRide', 'qRun', 'easyRun', 'easyRide', 'strides'],
};
const SLOT_SPORT = { longRide:'bike', qRide:'bike', easyRide:'bike', longRun:'run', qRun:'run', easyRun:'run', strides:'run', swimMain:'swim', swim2:'swim', swim3:'swim' };
const HARD = new Set(['longRide', 'longRun', 'qRide', 'qRun']);
const circ = (a, b) => { const x = Math.abs(a-b); return Math.min(x, 7-x); };

// Which day each slot goes on: the long ride on Saturday (or the last day), the long run the day after,
// hard sessions as far apart as possible and the same sport spread through the week.
function placeSlots(slots, days){
  const free = [...days].sort((a,b)=>a-b);
  const at = {};
  const take = d => { free.splice(free.indexOf(d), 1); };
  const longRide = free.includes(5) ? 5 : free[free.length-1];
  at.longRide = longRide; take(longRide);
  if (slots.includes('longRun') && free.length){
    const nextDay = (longRide + 1) % 7;
    const lr = free.includes(nextDay) ? nextDay : free.reduce((b, d) => circ(d, longRide) > circ(b, longRide) ? d : b, free[0]);
    at.longRun = lr; take(lr);
  }
  for (const s of slots){
    if (at[s] != null || !free.length) continue;
    const sport = SLOT_SPORT[s];
    let best = free[0], bestScore = -1;
    for (const d of free){
      const same = Object.keys(at).filter(k => SLOT_SPORT[k] === sport).map(k => at[k]);
      const hard = HARD.has(s) ? Object.keys(at).filter(k => HARD.has(k)).map(k => at[k]) : [];
      const score = Math.min(9, ...same.map(x => circ(d, x))) * 2 + Math.min(9, ...hard.map(x => circ(d, x)));
      if (score > bestScore){ best = d; bestScore = score; }
    }
    at[s] = best; take(best);
  }
  return at;
}

// Plan dates: starts the Monday on or after `start` (default: next Monday, or today if it's Monday),
// race on raceDate; between 4 and 24 weeks.
export function multiPlanDates(raceDate, start){
  const today = todayIso();
  const raceMon = addDays(raceDate, -((parseIso(raceDate).getDay()+6)%7));
  let s = start || (parseIso(today).getDay() === 1 ? today : mondayOnOrAfter(parseIso(today)));
  let weeks = Math.round((parseIso(raceMon) - parseIso(s)) / (7*86400000)) + 1;
  if (weeks > 24){ s = addDays(raceMon, -23*7); weeks = 24; }
  return { start: s, weeks, raceMon };
}

// cfg = { race, raceDate, days:[0..6], level } and the ride library -> a plan for the builder:
// { name, description, focus, start, raceDate, weeks:[{ week, phase, deload, note, days:[7] }] }.
export function buildMultiPlan(cfg, library){
  const R = RACES_BY_ID[cfg.race];
  if (!R || !cfg.raceDate || !Array.isArray(cfg.days) || cfg.days.length < 3) return null;
  // With lots of time before the race, start up to four weeks earlier than the plan's usual length.
  let { start, weeks: n } = multiPlanDates(cfg.raceDate, cfg.start);
  if (!cfg.start && n > R.weeks + 4){ start = addDays(start, (n - R.weeks - 4) * 7); n = R.weeks + 4; }
  if (n < 3) return null;
  const lk = (MULTI_LEVELS.find(l => l.id === cfg.level) || MULTI_LEVELS[1]).k;
  const days = [...new Set(cfg.days)].sort((a,b)=>a-b).filter(d => d >= 0 && d < 7);
  const slots = WEEK_SLOTS[R.sport].slice(0, Math.min(7, days.length));
  const at = placeSlots(slots, days);
  const taper = Math.min(R.taper, Math.max(1, n - 3));
  const buildN = n - 1 - taper; // the last week is race week
  const baseN = Math.max(1, Math.ceil(buildN * 0.35)), peakN = Math.max(1, Math.round(buildN * 0.2));
  const raceDayIdx = (parseIso(cfg.raceDate).getDay()+6)%7;
  const used = new Set();
  const ride = (kind, mins) => { const id = pickRide(library, kind, mins, used); if (id) used.add(id); return id; };
  const out = [];
  for (let i = 0; i < n; i++){
    const toRace = n-1-i;
    const phase = toRace === 0 ? 'race' : i >= buildN ? 'taper' : i < baseN ? 'base' : i >= buildN - peakN ? 'peak' : 'build';
    const deload = (phase === 'base' || phase === 'build') && i % 4 === 3 && i < buildN - 1;
    const f = buildN > 1 ? Math.min(1, i / (buildN - 1)) : 1;
    const scale = (deload ? 0.7 : phase === 'taper' ? (toRace === 1 ? 0.6 : 0.75) : 1) * lk;
    const lerp = ([a, b]) => (a + (b - a) * f) * scale;
    const wdays = DAY_NAMES.map(d => ({ day:d, type:'rest' }));
    const put = (di, obj) => { wdays[di] = Object.assign({ day: DAY_NAMES[di], type:'workout' }, obj); };
    const runDay = spec => ({ workoutType:'run', workoutId:'new', session: spec });
    const swimDay = spec => ({ workoutType:'swim', workoutId:'new', session: spec });
    if (phase === 'race'){
      // Race week: a few short sessions with some pace in them early on, then rest before race day.
      const before = days.filter(d => d < raceDayIdx - 1);
      const plan = R.sport === 'tri' ? ['swim', 'bike', 'run', 'swim'] : ['bike', 'run', 'bike'];
      before.slice(0, plan.length).forEach((d, j) => {
        const s = plan[j];
        if (s === 'swim') put(d, swimDay(makeSwim(j === 0 ? 'css' : 'easy', r50(R.swim[0] * 0.8))));
        else if (s === 'bike') put(d, { workoutType:'cycling', workoutId: ride('easy', 45) });
        else put(d, runDay(makeRun('strides', 25)));
      });
      put(raceDayIdx, { workoutType:'race', workoutId:'new', race:{ name:'Race day: '+R.label, date: cfg.raceDate, mins:R.mins, tss: Math.round(R.mins/60 * 0.85*0.85 * 100),
        text: R.legs+'. Start a little easier than you think, keep eating and drinking on the bike, and save something for the run.' } });
    } else {
      for (const s of slots){
        const di = at[s];
        if (di == null) continue;
        const easyWeek = deload || phase === 'taper' && toRace === 1;
        if (s === 'longRide'){
          const mins = r5(lerp(R.longRide));
          const brick = !deload && (phase === 'peak' || phase === 'taper' || phase === 'build' && i % 2 === 0);
          const rideId = ride(phase === 'base' || deload || mins > 95 ? 'long' : 'tempo', mins);
          if (brick) put(di, { workoutType:'brick', workoutId: rideId, runId:'new', session: makeRun('brick', r5(lerp(R.brickRun))) });
          else put(di, { workoutType:'cycling', workoutId: rideId });
        } else if (s === 'qRide'){
          const kind = easyWeek ? 'easy' : phase === 'base' ? 'sweetspot' : phase === 'peak' && R.sport === 'du' && i % 2 ? 'vo2' : 'threshold';
          put(di, { workoutType:'cycling', workoutId: ride(kind, r5(lerp(R.qRide))) });
        } else if (s === 'easyRide'){
          put(di, { workoutType:'cycling', workoutId: ride(deload ? 'recovery' : 'easy', r5(lerp(R.qRide) * 0.9)) });
        } else if (s === 'longRun'){
          put(di, runDay(makeRun('long', lerp(R.longRun))));
        } else if (s === 'qRun'){
          const type = easyWeek ? 'strides' : phase === 'base' ? (i % 2 ? 'hills' : 'strides') : phase === 'peak' ? 'intervals' : (i % 2 ? 'intervals' : 'tempo');
          put(di, runDay(makeRun(type, lerp(R.qRun))));
        } else if (s === 'easyRun' || s === 'strides'){
          put(di, runDay(makeRun(s === 'strides' ? 'strides' : 'easy', r5(lerp(R.qRun) * 0.85))));
        } else {
          // swims: the CSS test opens the plan, then a hard swim, an endurance swim and (with 7 days) a technique swim
          const m = r50(lerp(R.swim));
          let type = s === 'swimMain' ? (easyWeek ? 'technique' : phase === 'base' && i % 2 ? 'technique' : phase === 'peak' ? (i % 2 ? 'speed' : 'css') : 'css')
            : s === 'swim2' ? (phase === 'peak' || phase === 'taper' ? 'openwater' : 'endurance') : 'technique';
          if (i === 0 && s === 'swimMain') type = 'test';
          if (type === 'openwater' && !cfg.openWater) type = 'endurance';
          put(di, swimDay(makeSwim(type, s === 'swim3' ? m * 0.75 : m)));
        }
      }
    }
    out.push({ week: i+1, phase, deload, days: wdays, note: multiWeekNote(R, phase, deload, i, cfg.raceDate) });
  }
  const dateTxt = parseIso(cfg.raceDate).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  return { name: R.label+' plan', description: R.legs+'. Race day '+dateTxt+'.', focus:'multisport', start, raceDate: cfg.raceDate, race: R.id, weeks: out };
}

function multiWeekNote(R, phase, deload, i, raceDate){
  const tri = R.sport === 'tri';
  if (phase === 'race') return 'Race week. A few short sessions to stay sharp, then rest. Lay your kit out the night before. Race day is '+parseIso(raceDate).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' })+'.';
  if (deload) return 'Lighter week. Less of everything so the training sinks in. Finish it feeling fresh.';
  if (phase === 'taper') return 'Taper. Volume comes down and a little intensity stays. Sleep well and trust the work you\'ve done.';
  if (i === 0) return tri ? 'Week one. Start with the CSS test swim and put your times into Settings, so every swim after it has the right paces.' : 'Week one: settle into the routine. Keep the easy sessions really easy.';
  if (phase === 'base') return 'Base week: building endurance in every sport. Most of it should feel comfortable.';
  if (phase === 'peak') return 'Peak week: the most race-like training of the plan. The brick is the key session, so rest well around it.';
  return 'Build week: the hard sessions get longer. On brick days go straight from the bike to the run, like a race transition.';
}

// A blank plan for the builder: `weeks` weeks of rest days.
export function blankPlan(weeks = 4){
  return { name:'', description:'', focus:'custom', weeks: Array.from({ length: weeks }, (_, i) => ({ week: i+1, deload:false, days: DAY_NAMES.map(d => ({ day:d, type:'rest' })) })) };
}

// Planned TSS for a plan week, for the builder's week totals.
export function weekLoad(week, workouts, ftp){
  let tss = 0, secs = 0;
  for (const d of week.days || []){
    const s = sessionInfo(d, workouts, ftp);
    if (!s) continue;
    tss += s.tss || 0; secs += s.durationSec || 0;
  }
  return { tss: Math.round(tss), secs };
}
export { plannedRunTss };
