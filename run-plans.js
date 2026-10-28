// Race-goal running plans. The rider picks a goal race (5K, 10K, half or marathon), its date, the days
// they run, their long-run day, experience, how quickly to build and how many hard runs a week; the plan
// is generated from that (nothing stored but the settings key run_plan) as base, build and peak weeks,
// a cutback every fourth week, then a taper into race day. Sessions are registered with run.js so the
// rest of the app reads them like any run session.
//
// On its own the run plan is the followed plan (id RUN_PLAN_ID). Alongside a cycling plan its runs are
// laid onto that plan's rest days by date, and the race always gets its day.
import { addDays, parseIso, isoDate, mondayOnOrAfter, todayIso, planStart } from './plan-schedule.js?v=6';
import { registerRunSession, addRuns, fmtPace } from './run.js?v=9';
import { registerPlanSessions } from './plan-kit.js?v=4';
import { mergeStrength, STRENGTH_PLAN_ID } from './strength-programmes.js?v=2';

export const RUN_PLAN_KEY = 'run_plan';
export const RUN_PLAN_ID = 'run-plan';
export const PACE_SUGGEST_DISMISSED_KEY = 'run_pace_suggestion_dismissed';
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// speed: race speed as a multiple of threshold speed (so race pace = T / speed, and IF = speed).
export const RUN_GOALS = {
  '5k':       { label:'5K',            km:5,       speed:1.04,  weeks:8,  taper:1, longStart:{ new:35, regular:50, experienced:60 }, longPeak:{ new:50, regular:70, experienced:80 } },
  '10k':      { label:'10K',           km:10,      speed:1.00,  weeks:10, taper:1, longStart:{ new:40, regular:55, experienced:65 }, longPeak:{ new:65, regular:85, experienced:95 } },
  'half':     { label:'Half marathon', km:21.0975, speed:0.955, weeks:12, taper:2, longStart:{ new:45, regular:60, experienced:70 }, longPeak:{ new:100, regular:115, experienced:130 } },
  'marathon': { label:'Marathon',      km:42.195,  speed:0.90,  weeks:16, taper:3, longStart:{ new:60, regular:75, experienced:90 }, longPeak:{ new:150, regular:170, experienced:180 } },
};
export const RUN_LEVELS = [
  { id:'new', label:'New to running', text:'Running for under a year, or coming back.' },
  { id:'regular', label:'Run regularly', text:'Running most weeks for a year or more.' },
  { id:'experienced', label:'Experienced', text:'Raced before and comfortable with hard sessions.' },
];
export const RUN_BUILDS = [ { id:'gentle', label:'Gentle', k:1.35 }, { id:'steady', label:'Steady', k:1 }, { id:'progressive', label:'Progressive', k:0.75 } ];
const EASY = { new:[25,35], regular:[35,45], experienced:[40,55] };

const r5 = m => Math.max(15, Math.round(m/5)*5);
const wu = (m = 12) => ({ mins:m, zone:'easy' }), cd = (m = 10) => ({ mins:m, zone:'easy' });
const reps = (n, len, zone, rec) => Object.assign({ reps:n, zone, rec }, len);

// Quality sessions, by what they're for. Each is [name, steps, blurb].
const Q = {
  hills:    () => ['Hill reps', [wu(15), reps(8, { secs:60 }, 'interval', { secs:90, kind:'jog' }), cd()], 'On a steady hill: run up hard and tall, jog back down.'],
  fartlek:  () => ['Fartlek', [wu(), reps(8, { mins:1 }, 'threshold', { mins:1, kind:'jog' }), cd()], 'Relaxed surges. Settle back to easy between them.'],
  strides:  (m) => ['Easy run + strides', [{ mins:m, zone:'easy' }, reps(6, { secs:20 }, 'fast', { secs:60, kind:'walk' })], 'Strides are quick and relaxed, not sprints.'],
  thr: [
    () => ['Threshold 3 × 8 min', [wu(), reps(3, { mins:8 }, 'threshold', { mins:2, kind:'jog' }), cd()]],
    () => ['Threshold 4 × 6 min', [wu(), reps(4, { mins:6 }, 'threshold', { secs:90, kind:'jog' }), cd()]],
    () => ['Threshold 2 × 12 min', [wu(), reps(2, { mins:12 }, 'threshold', { mins:3, kind:'jog' }), cd()]],
    () => ['Tempo 20 min', [wu(15), { mins:20, zone:'threshold' }, cd()], 'One steady block at threshold. Even pace, no surging.'],
  ],
  int: [
    () => ['Intervals 6 × 800 m', [wu(15), reps(6, { km:0.8 }, 'interval', { mins:2, kind:'jog' }), cd()]],
    () => ['Intervals 5 × 1 km', [wu(15), reps(5, { km:1 }, 'interval', { mins:2, kind:'jog' }), cd()]],
    () => ['Intervals 8 × 400 m', [wu(15), reps(8, { km:0.4 }, 'interval', { secs:90, kind:'jog' }), cd()]],
    () => ['Intervals 4 × 1.2 km', [wu(15), reps(4, { km:1.2 }, 'interval', { mins:2, kind:'jog' }), cd()]],
  ],
  peak: {
    '5k':       [() => ['5K session: 5 × 1 km', [wu(15), reps(5, { km:1 }, 'interval', { mins:2, kind:'jog' }), cd()]],
                 () => ['5K session: 3 × 1.6 km', [wu(15), reps(3, { km:1.6 }, 'interval', { mins:3, kind:'jog' }), cd()]],
                 () => ['5K session: 10 × 400 m', [wu(15), reps(10, { km:0.4 }, 'interval', { secs:75, kind:'jog' }), cd()]]],
    '10k':      [() => ['10K session: 3 × 2 km', [wu(15), reps(3, { km:2 }, 'threshold', { secs:150, kind:'jog' }), cd()]],
                 () => ['10K session: 5 × 1 km', [wu(15), reps(5, { km:1 }, 'interval', { secs:90, kind:'jog' }), cd()]],
                 () => ['10K session: 6 × 1.5 km', [wu(15), reps(6, { km:1.5 }, 'threshold', { mins:2, kind:'jog' }), cd()]]],
    'half':     [() => ['Half session: 2 × 20 min', [wu(15), reps(2, { mins:20 }, 'threshold', { mins:3, kind:'jog' }), cd()]],
                 () => ['Half session: 3 × 3 km', [wu(15), reps(3, { km:3 }, 'threshold', { secs:150, kind:'jog' }), cd()]],
                 () => ['Steady 40 min', [wu(15), { mins:40, zone:'steady' }, cd()], 'Around half marathon effort: controlled, not racing.']],
    'marathon': [() => ['Marathon pace 3 × 5 km', [wu(15), reps(3, { km:5 }, 'steady', { mins:3, kind:'jog' }), cd()], 'Marathon pace: practise your race-day rhythm and fuelling.'],
                 () => ['Threshold 2 × 20 min', [wu(15), reps(2, { mins:20 }, 'threshold', { mins:3, kind:'jog' }), cd()]],
                 () => ['Marathon pace 16 km', [wu(15), { km:16, zone:'steady' }, cd()], 'One long block at marathon pace.']],
  },
  sharpener: () => ['Race-week sharpener', [wu(15), reps(4, { mins:2 }, 'threshold', { mins:2, kind:'jog' }), cd()], 'Short and sharp to stay fresh. Nothing should feel hard.'],
};

// Plan dates: starts the Monday on or after `start` (default: next Monday, or today if it's Monday),
// race on raceDate; between 4 and 24 weeks.
export function runPlanDates(cfg){
  const today = todayIso();
  const raceMon = addDays(cfg.raceDate, -((parseIso(cfg.raceDate).getDay()+6)%7));
  let start = cfg.start || (parseIso(today).getDay() === 1 ? today : mondayOnOrAfter(parseIso(today)));
  let weeks = Math.round((parseIso(raceMon) - parseIso(start)) / (7*86400000)) + 1;
  if (weeks > 24){ start = addDays(raceMon, -23*7); weeks = 24; }
  return { start, weeks, raceMon };
}

// Days of the week for the key runs: long run on longDay, hard runs spread as far from it (and each other) as possible.
function assignDays(days, longDay, hardCount){
  const others = days.filter(d => d !== longDay);
  const dist = (a, b) => { const x = Math.abs(a-b); return Math.min(x, 7-x); };
  const hard = [];
  for (let i = 0; i < hardCount && others.length > hard.length; i++){
    let best = null, bestScore = -1;
    for (const d of others){
      if (hard.includes(d)) continue;
      const score = Math.min(dist(d, longDay), ...hard.map(h => dist(d, h)));
      if (score > bestScore){ best = d; bestScore = score; }
    }
    if (best != null) hard.push(best);
  }
  return { hard: hard.sort((a,b)=>a-b), easy: others.filter(d => !hard.includes(d)) };
}

// cfg = { goal, raceDate, start?, days:[0..6 Mon..Sun], longDay, level, build, hard } -> a plan object
// { id, name, goal, weeks:[{ week, phase, deload, note, days:[7] }] } whose run sessions are registered.
export function buildRunPlan(cfg){
  const g = RUN_GOALS[cfg.goal];
  if (!g || !cfg.raceDate || !Array.isArray(cfg.days) || !cfg.days.length) return null;
  const level = EASY[cfg.level] ? cfg.level : 'regular';
  const { start, weeks: n } = runPlanDates(cfg);
  if (n < 2) return null;
  const days = [...new Set(cfg.days)].sort((a,b)=>a-b);
  const longDay = days.includes(cfg.longDay) ? cfg.longDay : days[days.length-1];
  // one hard run a week from 2 run days, two from 4 (never two for new runners)
  const maxHard = days.length >= 4 ? 2 : days.length >= 2 ? 1 : 0;
  const { hard, easy } = assignDays(days, longDay, Math.min(level === 'new' ? 1 : (cfg.hard || 1), maxHard));
  const k = (RUN_BUILDS.find(b => b.id === cfg.build) || RUN_BUILDS[1]).k;
  const taper = Math.min(g.taper, Math.max(1, n - 2));
  const buildN = n - taper;
  const baseN = Math.max(1, Math.ceil(buildN * 0.35)), peakN = Math.max(1, Math.round(buildN * 0.2));
  const raceDayIdx = (parseIso(cfg.raceDate).getDay()+6)%7;
  let qi = 0;
  const out = [];
  for (let i = 0; i < n; i++){
    const toRace = n-1-i;
    const phase = toRace === 0 ? 'race' : i >= buildN ? 'taper' : i < baseN ? 'base' : i >= buildN - peakN ? 'peak' : 'build';
    const deload = (phase === 'base' || phase === 'build') && i % 4 === 3 && i < buildN - 1;
    const prog = buildN > 1 ? Math.min(1, i / (buildN - 1)) : 1;
    const f = Math.pow(prog, k);
    const scale = deload ? 0.75 : phase === 'taper' ? (toRace === 1 ? 0.6 : 0.75) : phase === 'race' ? 0.5 : 1;
    const longMins = r5((g.longStart[level] + (g.longPeak[level] - g.longStart[level]) * f) * scale);
    const easyMins = r5((EASY[level][0] + (EASY[level][1] - EASY[level][0]) * f) * (deload || phase === 'taper' ? 0.8 : phase === 'race' ? 0.6 : 1));
    const wdays = DAY_NAMES.map(d => ({ day:d, type:'rest' }));
    const put = (di, slot, [name, steps, blurb], kind) => {
      const id = 'rp-'+cfg.goal+'-w'+(i+1)+'-'+slot;
      registerRunSession(id, { name, kind, steps, blurb });
      wdays[di] = { day: DAY_NAMES[di], type:'workout', workoutType:'run', workoutId:id };
    };
    let keyName = null;
    if (phase === 'race'){
      const before = days.filter(d => d < raceDayIdx);
      before.forEach((d, j) => put(d, 'e'+j, j === 0 && before.length > 1 ? Q.sharpener() : Q.strides(Math.min(easyMins, 25)), j === 0 && before.length > 1 ? 'quality' : 'easy'));
      put(raceDayIdx, 'race', ['Race day: '+g.label, [{ km:g.km, zone:'race', IF:g.speed }], 'Start a little slower than goal pace, settle in, and save something for the last quarter.'], 'race');
      keyName = 'Race day';
    } else {
      // long run, with a steady finish on alternate build/peak weeks for half and marathon
      const steadyFinish = (cfg.goal === 'half' || cfg.goal === 'marathon') && (phase === 'build' || phase === 'peak') && !deload && i % 2 === 0;
      put(longDay, 'long', steadyFinish
        ? ['Long run, steady finish', [{ mins: longMins - 20, zone:'easy' }, { mins:20, zone:'steady' }], 'Easy for most of it, then the last 20 minutes at a steady, marathon-ish effort.']
        : ['Long run', [{ mins: longMins, zone:'easy' }], 'Keep it easy enough that the last 10 minutes feel as controlled as the first.'], 'long');
      hard.forEach((d, j) => {
        let s;
        if (deload || phase === 'base' && (j === 0 || i === 0)) s = Q.strides(easyMins);
        else if (phase === 'base') s = (i % 2 ? Q.fartlek : Q.hills)();
        else if (phase === 'taper') s = (cfg.goal === '5k' || cfg.goal === '10k') ? Q.int[1]() : Q.thr[0]();
        else if (phase === 'peak' && j === 0) s = Q.peak[cfg.goal][qi % 3]();
        else if (cfg.goal === 'marathon' && j === 1) s = Q.peak.marathon[0]();
        else {
          // 5K and 10K lean on intervals, half and marathon on threshold; with two hard runs, one of each
          const short = cfg.goal === '5k' || cfg.goal === '10k';
          const useInt = hard.length > 1 ? (j === 0) === short : short && qi % 2 === 0;
          s = (useInt ? Q.int : Q.thr)[qi % 4]();
        }
        if (j === 0 && !(deload || phase === 'base')) keyName = s[0];
        put(d, 'q'+j, s, s[0].startsWith('Easy') ? 'easy' : 'quality');
      });
      if (!(deload || phase === 'base')) qi++;
      easy.forEach((d, j) => put(d, 'e'+j, ['Easy run', [{ mins: easyMins, zone:'easy' }], 'Conversational pace the whole way.'], 'easy'));
    }
    out.push({ week:i+1, phase, deload, days: wdays, note: weekNote(phase, deload, i, keyName, cfg.raceDate) });
  }
  return { id: RUN_PLAN_ID, name: g.label+' plan', goal: cfg.goal, raceDate: cfg.raceDate, start, weeks: out };
}

function weekNote(phase, deload, i, key, raceDate){
  if (phase === 'race') return 'Race week. Short and sharp early on, then rest your legs. Race day is '+parseIso(raceDate).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' })+'.';
  if (deload) return 'Lighter week. Less running so the work sinks in. You should finish it feeling fresh.';
  if (phase === 'taper') return 'Taper. Volume comes down and a little intensity stays. Trust the training and sleep well.';
  if (i === 0) return 'Week one: settle into the routine. Everything is easy apart from a few strides, so keep it conversational.';
  if (phase === 'base') return 'Base week: building your aerobic engine and the habit. Easy runs really should feel easy.';
  if (phase === 'peak') return 'Peak week: the most race-like work of the plan. Rest well around '+(key || 'the key session')+'.';
  return 'Build week: the key session is '+(key || 'your hard run')+'. Hit the paces and keep everything else easy.';
}

// A note for any plan week, for Today and the plan pages. Run plan weeks carry their own; cycling plans get one
// from where the week sits in the plan.
export function planWeekNote(plan, weekIdx){
  const w = plan && plan.weeks && plan.weeks[weekIdx];
  if (!w) return null;
  if (w.runNote && !w.note) return w.runNote;
  if (w.note) return w.note;
  const last = plan.weeks.length - 1;
  if (w.deload) return 'Lighter week. Less volume so the work sinks in. You should finish it feeling fresh.';
  if (weekIdx === 0) return 'Week one: find your rhythm. Ride the targets as written, and if a session feels off, ease the intensity down a few percent.';
  if (weekIdx === last) return 'Final week: finish the block strongly. A Ramp Test afterwards resets your targets for the next one.';
  return 'Week '+(weekIdx+1)+' of '+plan.weeks.length+': the key sessions are the hard ones. Keep recovery rides truly easy.';
}

// The plan the rider follows: a cycling plan (with its run days, or a run plan merged in), or the run plan alone.
// follow: from loadFollowState(); runCfg: settings run_plan or null. Returns { plan, startedAt }.
export function composeFollowed(cyclingRow, follow, runCfg){
  const out = composeBase(cyclingRow, follow, runCfg);
  const sp = follow && follow.strengthPlan;
  if (!sp) return out;
  // A strength programme goes on top: on its own it is the plan, otherwise it uses strength and rest days.
  if (!out.plan) return { plan: mergeStrength(null, sp.start, sp), startedAt: sp.start };
  return { plan: mergeStrength(out.plan, out.startedAt, sp), startedAt: out.startedAt };
}
function composeBase(cyclingRow, follow, runCfg){
  const rp = runCfg ? buildRunPlan(runCfg) : null;
  registerPlanSessions(cyclingRow); // a plan from the plan builder carries its own run and swim sessions
  if (cyclingRow && follow.startedAt){
    // a plan with its own runs (a triathlon plan, say) already has the running it needs
    if (!rp || hasOwnRuns(cyclingRow)) return { plan: addRuns(cyclingRow, follow.runs), startedAt: follow.startedAt };
    return { plan: mergeRunPlan(cyclingRow, follow.startedAt, rp), startedAt: follow.startedAt };
  }
  if (rp) return { plan: rp, startedAt: rp.start };
  return { plan: null, startedAt: null };
}
function hasOwnRuns(plan){ return (plan.weeks || []).some(w => (w.days || []).some(d => d && (d.workoutType === 'run' || d.workoutType === 'brick'))); }
function mergeRunPlan(cyc, cycStartIso, rp){
  const cycStart = planStart(cycStartIso);
  const offset = Math.round((parseIso(rp.start) - parseIso(cycStart)) / 86400000);
  const total = Math.max((cyc.weeks||[]).length * 7, offset + rp.weeks.length * 7);
  const weeks = [];
  // Runs go on cycling rest days. A run that lands on a ride day moves to the nearest free day that
  // week (race first, then the long run, then key sessions), or is dropped when the week is full.
  const RANK = id => id.endsWith('-race') ? 0 : id.endsWith('-long') ? 1 : /-q\d$/.test(id) ? 2 : 3;
  for (let wi = 0; wi*7 < total; wi++){
    const cw = (cyc.weeks||[])[wi];
    const days = [], clash = [];
    for (let di = 0; di < 7; di++){
      const c = cw && cw.days && cw.days[di] || { day: DAY_NAMES[di], type:'rest' };
      const ri = wi*7 + di - offset;
      const r = ri >= 0 && ri < rp.weeks.length*7 ? rp.weeks[Math.floor(ri/7)].days[ri%7] : null;
      const isRace = r && r.workoutId && r.workoutId.endsWith('-race');
      if (r && r.type === 'workout' && (c.type !== 'workout' || isRace)) days.push(Object.assign({}, r, { day: c.day || r.day }));
      else { days.push(c); if (r && r.type === 'workout') clash.push({ r, di }); }
    }
    clash.sort((a, b) => RANK(a.r.workoutId) - RANK(b.r.workoutId));
    for (const { r, di } of clash){
      let to = -1;
      for (let k = 1; k < 7 && to < 0; k++) for (const d of [di + k, di - k]) if (d >= 0 && d < 7 && days[d].type !== 'workout' && wi*7 + d >= offset){ to = d; break; }
      if (to >= 0) days[to] = Object.assign({}, r, { day: days[to].day || DAY_NAMES[to] });
    }
    const rw = Math.floor((wi*7 - offset) / 7);
    weeks.push(Object.assign({ week: wi+1 }, cw || {}, { days, runNote: rp.weeks[rw] ? rp.weeks[rw].note : null }));
  }
  return Object.assign({}, cyc, { weeks, runGoal: rp.goal, raceDate: rp.raceDate });
}

// ---- race predictions and threshold pace from runs ----
export function predictTime(goal, T){ const g = RUN_GOALS[goal]; return g && T ? Math.round(g.km * T / g.speed) : null; }
export function goalPace(goal, T){ const g = RUN_GOALS[goal]; return g && T ? Math.round(T / g.speed) : null; }

// From best efforts within runs (completed_rides.run_bests) in the last 90 days: the threshold pace they imply.
// Returns null, or { pace, basis, rideId, date }.
const FROM_BEST = [[5000, 5, 1.04, '5K'], [10000, 10, 1.00, '10K'], [21097, 21.0975, 0.955, 'half marathon']];
export function paceFromRuns(runs, now = new Date()){
  const since = new Date(now.getTime() - 90*86400000).toISOString();
  let best = null;
  for (const r of runs || []){
    if (!r.run_bests || r.started_at < since) continue;
    for (const [m, km, speed, label] of FROM_BEST){
      const t = Number(r.run_bests[m]);
      if (!t) continue;
      const pace = Math.round(t / km * speed);
      if (!best || pace < best.pace) best = { pace, basis: 'your '+label+' in '+fmtDuration(t), rideId: r.id, date: r.started_at };
    }
  }
  return best;
}
// Suggest only a clearly faster pace (2% or more), or any pace when none is set, and not one already turned down.
export function shouldSuggestPace(est, current, dismissed){
  if (!est) return false;
  if (dismissed && Math.abs(dismissed - est.pace) <= 2) return false;
  return !current || est.pace <= current * 0.98;
}
function fmtDuration(sec){ const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60; return h ? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : m+':'+String(s).padStart(2,'0'); }
export { fmtDuration };

// The followed cycling plan's row (null for a run plan on its own), then the plan as the rider sees it.
export async function loadPlanRow(supabase, follow){
  if (!follow.planId || follow.planId === RUN_PLAN_ID || follow.planId === STRENGTH_PLAN_ID) return null;
  const { data } = await supabase.from('training_plans').select('id,name,weeks').eq('id', follow.planId).maybeSingle();
  return data || null;
}

export async function loadRunPlan(supabase, userId){
  try {
    const { data } = await supabase.from('settings').select('value').eq('user_id', userId).eq('key', RUN_PLAN_KEY).maybeSingle();
    return data && data.value && data.value.v && data.value.v.goal ? data.value.v : null;
  } catch(_){ return null; }
}
export function daysLabel(days){ return [...days].sort((a,b)=>a-b).map(d => DAY_NAMES[d]).join(', '); }
export { DAY_NAMES, isoDate, fmtPace };
