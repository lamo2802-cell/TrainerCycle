// Strength programmes: multi-week strength blocks with phases (Build, Strength, Maintain, Deload) that
// drop onto the plan the rider follows, the same way a run plan merges onto a cycling plan.
//
// Each programme session for each phase is a shared row in strength_workouts (id 'sp-<programme>-<session>-<phase>',
// source 'programme'), generated from the definitions below by sessionWorkout(). So every page that already
// names and opens strength workouts handles them without changes.
// The rider's programme is settings key strength_plan: { id, start: 'YYYY-MM-DD' Monday }.
// Followed on its own (no cycling or run plan) it is the followed plan, id STRENGTH_PLAN_ID.

import { addDays, parseIso, planStart, mondayOnOrAfter, todayIso, daysBetween } from './plan-schedule.js?v=5';

export const STRENGTH_PLAN_KEY = 'strength_plan';
export const STRENGTH_PLAN_ID = 'strength-plan';
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// How the main lifts are done in each phase. Accessory moves keep their own reps.
export const PHASES = {
  build:    { label:'Build', sets:3, reps:8, repsMax:12, rest:90, note:'Build: finish each set with about 2 reps left.' },
  strength: { label:'Strength', sets:4, reps:5, repsMax:6, rest:150, note:'Strength: heavy sets with about 2 reps left. Take the full rest.' },
  maintain: { label:'Maintain', sets:2, reps:5, repsMax:6, rest:150, note:'Maintain: short and heavy, about 3 reps left. Keeps strength without tiring your legs for riding.' },
  deload:   { label:'Deload', sets:2, reps:8, repsMax:8, rest:60, note:'Deload: fewer sets and stop with 4 or more reps left. Let the work sink in.' },
  base:     { label:'Base', sets:2, reps:8, repsMax:15, rest:60, note:'Learn the moves: smooth reps, stop with 2 or 3 left.' },
  base3:    { label:'Base', sets:3, reps:8, repsMax:15, rest:60, note:'Three sets now. Smooth reps, stop with 2 left.' },
  care:     { label:'Control', sets:2, reps:12, repsMax:15, rest:45, note:'Slow and controlled. Stop if anything hurts.' },
  care3:    { label:'Control', sets:3, reps:12, repsMax:15, rest:45, note:'Three sets now, still slow and controlled.' },
};
const PHASE_COLOR = { build:'#7FD8CC', strength:'#F0A35E', maintain:'#4C8BF5', deload:'#5A6577', base:'#7FD8CC', base3:'#45D6C4', care:'#7FD8CC', care3:'#45D6C4' };
export function phaseColor(p){ return PHASE_COLOR[p] || '#45D6C4'; }

// Sessions: main lifts follow the phase; accessories ({ sets, reps, notes }) stay as written.
const M = (key, notes, variant) => ({ key, main:true, notes: notes || '', variant });
const A = (key, sets, reps, notes, variant) => ({ key, sets, reps, notes: notes || '', variant });

export const PROGRAMMES = {
  cyclist: {
    name:'Cyclist Strength', weeks:12, perWeek:'2, then 1', equipment:'Dumbbells, kettlebells or a gym',
    blurb:'Twelve weeks for riders: three weeks building, then heavy strength work, then a lighter block that keeps it while riding takes over. Deload weeks in weeks 4 and 8.',
    schedule:['build','build','build','deload','strength','strength','strength','deload','maintain','maintain','maintain','maintain'],
    sessions:{
      a:{ name:'A', title:'Lower + push', list:[ M('squat','3 sec lower, knees over toes'), M('deadlift','Hinge from the hips, flat back'), A('lunge',3,8,'Each side. Control the knee, no inward collapse'), A('glute_bridge',3,10,'Single-leg, 2 sec pause at the top','sl_glute_bridge'), A('pushup',3,10,'3 sec lower'), A('plank',3,1,'Hold 40-45 seconds') ] },
      b:{ name:'B', title:'Upper + hips', list:[ M('lunge','Bulgarian split squat, rear foot on a bench','split_squat'), M('row','Pause at the chest'), M('shoulder_press',''), A('standing_hip_abduction',3,15,'Each side'), A('calf_raise',3,15,'Slow, full range'), A('plank',2,1,'Side plank, hold 30 seconds each side','side_plank') ] },
      m:{ name:'', title:'Full body', list:[ M('squat',''), M('deadlift',''), M('row',''), A('plank',2,1,'Hold 45 seconds') ] },
    },
    // Sessions each week by phase.
    week:{ build:['a','b'], strength:['a','b'], deload:['a','b'], maintain:['m'] },
  },
  inseason: {
    name:'In-season Maintenance', weeks:8, perWeek:'1', equipment:'Dumbbells, kettlebells or a gym',
    blurb:'One short, heavy session a week to hold on to strength through the racing or event season without tiring your legs. Lighter every fourth week.',
    schedule:['maintain','maintain','maintain','deload','maintain','maintain','maintain','deload'],
    sessions:{ m:{ name:'', title:'Full body', list:[ M('squat',''), M('deadlift',''), M('row',''), A('pushup',2,10,''), A('plank',2,1,'Hold 45 seconds') ] } },
    week:{ maintain:['m'], deload:['m'] },
  },
  homedb: {
    name:'Home Dumbbells', weeks:8, perWeek:'2', equipment:'A set of dumbbells',
    blurb:'Eight weeks with just dumbbells at home: three building weeks, a deload, three heavier weeks and a final deload.',
    schedule:['build','build','build','deload','strength','strength','strength','deload'],
    sessions:{
      a:{ name:'A', title:'Squat + push', list:[ M('squat','','goblet_squat'), M('deadlift','','db_rdl'), M('pushup','Dumbbell floor or bench press','db_bench'), M('row','','db_row'), A('plank',3,1,'Hold 40 seconds') ] },
      b:{ name:'B', title:'Lunge + pull', list:[ M('lunge','','split_squat'), M('row','','db_row'), M('shoulder_press','','db_press'), A('glute_bridge',3,12,'Hold a dumbbell on your hips','hip_thrust'), A('bicep_curl',2,12,'','db_curl'), A('calf_raise',3,15,'') ] },
    },
    week:{ build:['a','b'], strength:['a','b'], deload:['a','b'] },
  },
  bodyweight: {
    name:'Bodyweight Start', weeks:6, perWeek:'2', equipment:'None',
    blurb:'Six weeks with no equipment to learn the moves and build a base. Moves get harder as they get easy, such as knee push-ups to full push-ups.',
    schedule:['base','base','base3','base3','base3','deload'],
    sessions:{
      a:{ name:'A', title:'Squat + push', list:[ M('squat','','bw_squat'), M('pushup','Knees down if needed'), M('glute_bridge','','glute_bridge'), A('mountain_climber',2,20,'20 total, 10 each side'), A('plank',2,1,'Hold 30 seconds') ] },
      b:{ name:'B', title:'Lunge + core', list:[ M('lunge','Each side','bw_lunge'), M('calf_raise','','calf_raise'), M('glute_bridge','Each side','sl_glute_bridge'), A('situp',2,12,''), A('plank',2,1,'Side plank, 20 seconds each side','side_plank') ] },
    },
    week:{ base:['a','b'], base3:['a','b'], deload:['a','b'] },
  },
  knee: {
    name:'Knee & Hip Support', weeks:6, perWeek:'2', equipment:'A band helps',
    blurb:'Six weeks of low-load hip and knee work for riders with grumbly knees: glutes, hip control and quads, slow and controlled.',
    schedule:['care','care','care3','care3','care3','care3'],
    sessions:{
      a:{ name:'A', title:'Hips', list:[ M('clamshell','Each side, slow'), M('standing_hip_abduction','Each side','hip_abduction'), M('glute_bridge','2 sec squeeze at the top'), M('straight_leg_raise','Each leg, lock the quad first'), A('calf_raise',2,15,'') ] },
      b:{ name:'B', title:'Knee control', list:[ M('lunge','Short, pain-free range, each side','bw_lunge'), M('glute_bridge','Each side','sl_glute_bridge'), M('clamshell','Each side, slow'), M('squat','Slow, to a box or chair','bw_squat'), A('plank',2,1,'Hold 30 seconds') ] },
    },
    week:{ care:['a','b'], care3:['a','b'] },
  },
};

const NAMES = { pushup:'Push-up', situp:'Sit-up' };
export function sessionId(prog, s, phase){ return 'sp-'+prog+'-'+s+'-'+phase; }
export function parseSessionId(id){
  const m = /^sp-([a-z]+)-([a-z]+)-([a-z0-9]+)$/.exec(id || '');
  return m && PROGRAMMES[m[1]] ? { prog:m[1], session:m[2], phase:m[3] } : null;
}

// The workout (strength_workouts row shape) for one programme session in one phase.
export function sessionWorkout(prog, s, phase){
  const P = PROGRAMMES[prog], S = P.sessions[s], ph = PHASES[phase];
  const deload = phase === 'deload';
  const exercises = S.list.map(e => {
    const base = { key:e.key, name: NAMES[e.key] || e.key.replace(/_/g,' ').replace(/^./, c => c.toUpperCase()) };
    if (e.variant) base.variant = e.variant;
    if (e.main){
      // In a deload of a body-weight programme keep the reps where they were.
      return Object.assign(base, { sets: ph.sets, reps: deload && prog === 'bodyweight' ? 8 : ph.reps, repsMax: deload && prog === 'bodyweight' ? 12 : ph.repsMax, restSeconds: ph.rest, notes: [e.notes, ph.note].filter(Boolean).join('. ') });
    }
    return Object.assign(base, { sets: deload ? Math.min(2, e.sets) : e.sets, reps: e.reps, restSeconds: 45, notes: e.notes });
  });
  return { id: sessionId(prog, s, phase), name: P.name + (S.name ? ' ' + S.name : '') + ' · ' + ph.label, exercises };
}
// Rough minutes for a session: 40 s a set plus the rest.
export function sessionMins(w){
  const sec = w.exercises.reduce((t, e) => t + e.sets * 40 + Math.max(0, e.sets - 1) * (e.restSeconds || 60) + 60, 0);
  return Math.round(sec / 300) * 5;
}
// Every programme session row, for the SQL that seeds strength_workouts.
export function allSessionWorkouts(){
  const out = [];
  for (const [prog, P] of Object.entries(PROGRAMMES)){
    const seen = new Set();
    for (const phase of P.schedule) for (const s of P.week[phase]) {
      const id = sessionId(prog, s, phase); if (seen.has(id)) continue; seen.add(id);
      out.push(sessionWorkout(prog, s, phase));
    }
  }
  return out;
}

// Week by week: [{ phase, sessions:[{ id, name, mins }] }]
export function programmeWeeks(prog){
  const P = PROGRAMMES[prog]; if (!P) return [];
  return P.schedule.map(phase => ({ phase, sessions: P.week[phase].map(s => { const w = sessionWorkout(prog, s, phase); return { id:w.id, name:w.name, mins: sessionMins(w) }; }) }));
}
export function weekNote(prog, wi){
  const P = PROGRAMMES[prog], phase = P && P.schedule[wi];
  return phase ? P.name + ', week ' + (wi+1) + ' of ' + P.weeks + '. ' + PHASES[phase].note : null;
}
// Where the rider is in the programme today: { week (0-based), phase, done, notStarted }.
export function programmeStatus(cfg, today = todayIso()){
  const P = cfg && PROGRAMMES[cfg.id]; if (!P) return null;
  const d = daysBetween(cfg.start, today);
  const week = Math.floor(d / 7);
  return { programme: P, week: Math.max(0, Math.min(P.weeks - 1, week)), phase: P.schedule[Math.max(0, Math.min(P.weeks - 1, week))], notStarted: d < 0, done: week >= P.weeks };
}
export function defaultStart(){ return mondayOnOrAfter(new Date()); }

const DEFAULT_DAYS = { 1:[2], 2:[1,4], 3:[0,2,4] };
function dayObj(s, di){ return { day: DAY_NAMES[di], type:'workout', workoutType:'strength', workoutId: s.id, name: s.name, mins: s.mins }; }
const isWorkout = d => d && d.type === 'workout';

// Rest days to use for n strength sessions in a week: not the day before a session where possible,
// and spread out. days: the week's 7 day objects.
function pickDays(days, n, taken){
  const chosen = taken.slice();
  const free = [0,1,2,3,4,5,6].filter(di => !isWorkout(days[di]) && !chosen.includes(di));
  while (chosen.length < n && free.length){
    let best = null, bestScore = -Infinity;
    for (const di of free){
      let score = 0;
      if (isWorkout(days[di+1]) && days[di+1].workoutType !== 'strength') score -= 2; // keep the next session fresh
      if (isWorkout(days[di-1]) && days[di-1].workoutType !== 'strength') score += 1;  // after a ride is fine
      const gap = chosen.length ? Math.min(...chosen.map(c => Math.abs(c - di))) : 7;
      score += Math.min(gap, 3);
      if (score > bestScore){ bestScore = score; best = di; }
    }
    chosen.push(best); free.splice(free.indexOf(best), 1);
  }
  return chosen.sort((a,b)=>a-b);
}

// The followed plan with the programme dropped on: a plan's own strength days are used for programme
// sessions first, then rest days. base null -> the programme on its own.
export function mergeStrength(base, baseStartIso, cfg){
  const P = cfg && PROGRAMMES[cfg.id]; if (!P) return base;
  const weeksP = programmeWeeks(cfg.id);
  if (!base){
    const weeks = weeksP.map((w, wi) => {
      const days = DAY_NAMES.map(day => ({ day, type:'rest' }));
      (DEFAULT_DAYS[w.sessions.length] || DEFAULT_DAYS[2]).forEach((di, k) => { if (w.sessions[k]) days[di] = dayObj(w.sessions[k], di); });
      return { week: wi+1, days, deload: w.phase === 'deload', note: weekNote(cfg.id, wi), strengthPhase: w.phase };
    });
    return { id: STRENGTH_PLAN_ID, name: P.name, start: cfg.start, weeks, strengthProgramme: cfg.id };
  }
  const offset = daysBetween(planStart(baseStartIso), cfg.start);
  const total = Math.max((base.weeks||[]).length * 7, offset + weeksP.length * 7);
  const weeks = [];
  for (let wi = 0; wi*7 < total; wi++){
    const bw = (base.weeks||[])[wi];
    const days = [0,1,2,3,4,5,6].map(di => (bw && bw.days && bw.days[di]) || { day: DAY_NAMES[di], type:'rest' });
    const pw = Math.floor((wi*7 - offset) / 7);
    const pweek = pw >= 0 && (wi*7 - offset) % 7 === 0 ? weeksP[pw] : null;
    if (!pweek){ weeks.push(Object.assign({ week: wi+1 }, bw || { days })); continue; }
    const own = [0,1,2,3,4,5,6].filter(di => isWorkout(days[di]) && days[di].workoutType === 'strength');
    let slots = own.slice(0, pweek.sessions.length);
    own.slice(pweek.sessions.length).forEach(di => { days[di] = { day: days[di].day || DAY_NAMES[di], type:'rest' }; });
    slots = pickDays(days, pweek.sessions.length, slots);
    const out = days.slice();
    slots.forEach((di, k) => { out[di] = Object.assign(dayObj(pweek.sessions[k], di), { day: days[di].day || DAY_NAMES[di] }); });
    weeks.push(Object.assign({ week: wi+1 }, bw || {}, { days: out, strengthNote: weekNote(cfg.id, pw), strengthPhase: pweek.phase }));
  }
  return Object.assign({}, base, { weeks, strengthProgramme: cfg.id });
}

// The main lifts of a programme (each once), for the end-of-programme retest.
export function retestLifts(prog){
  const P = PROGRAMMES[prog]; if (!P) return [];
  const seen = new Set(), out = [];
  Object.values(P.sessions).forEach(S => S.list.filter(e => e.main).forEach(e => {
    const k = e.key + ':' + (e.variant || '');
    if (!seen.has(k)){ seen.add(k); out.push({ key:e.key, variant:e.variant }); }
  }));
  return out.slice(0, 5);
}
