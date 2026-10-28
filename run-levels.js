// Run progression levels, like the cycling ones in levels.js. Every run session gets a pace zone (Easy …
// Fast) and a level from 1 to 10 from its steps, and each rider has a level per zone that rises when they
// log a run at or above it. Levels are recomputed from run history each time.
// A run logged against a session (completed_rides.workout_id = a run.js session id: a plan run, a
// suggested run, or a Strava run linked to the plan) counts at that session's level. A run with no
// session (Strava, or logged freehand) only says how long and how hard overall, so it counts as a
// non-stop run in Easy, and in Steady too when it was run at a steady pace or faster: one hard run's
// average can't say what intervals were in it.
import { PACE_ZONES, RUN_SESSIONS, runSession } from './run.js?v=9';

// ref: how much running in the zone (and how long one unbroken stretch) makes a level 10. minSec: how
// much of a session must be in the zone (or faster) for it to be that zone's session. Easy uses a
// gentler curve (exp) so the walk/run steps for new runners each get their own level.
export const RUN_LEVEL_ZONES = PACE_ZONES.map(z => Object.assign({ key: z.id, name: z.name, color: z.color }, {
  easy:      { short:'Easy', minSec:0,    refSec:120*60, refRep:120*60, exp:0.75 },
  steady:    { short:'Std',  minSec:900,  refSec:75*60,  refRep:75*60,  exp:1 },
  threshold: { short:'Thr',  minSec:540,  refSec:40*60,  refRep:20*60,  exp:1 },
  interval:  { short:'Int',  minSec:360,  refSec:20*60,  refRep:5*60,   exp:1 },
  fast:      { short:'Fast', minSec:150,  refSec:6*60,   refRep:60,     exp:1 },
}[z.id]));
const ORDER = RUN_LEVEL_ZONES.map(z => z.key);
const BY_KEY = Object.fromEntries(RUN_LEVEL_ZONES.map(z => [z.key, z]));
const FEEL_BONUS = { 1:0.4, 2:0.25, 3:0.1, 4:0, 5:-0.3 };
const DEFAULT_PACE = 300;
export function runZoneInfo(key){ return BY_KEY[key] || null; }

// The session's running as [{ sec, zone }] blocks (walks and recoveries leave a gap between them).
function blocks(steps){
  const out = [];
  for (const st of steps || []){
    if (!BY_KEY[st.zone]){ out.push({ sec:0, zone:null }); continue; }   // walk or race: breaks the stretch
    const z = PACE_ZONES.find(p => p.id === st.zone);
    const one = st.km ? st.km * DEFAULT_PACE * (z.lo + z.hi) / 2 : (st.mins || 0)*60 + (st.secs || 0);
    for (let i = 0; i < (st.reps || 1); i++){
      out.push({ sec: one, zone: st.zone });
      if (st.rec) out.push({ sec:0, zone:null });
    }
  }
  return out;
}

// { zone, level } for a session's steps, or null (a race, or nothing to run).
export function runStepsLevel(steps){
  const bl = blocks(steps);
  if (!bl.some(b => b.zone)) return null;
  const at = (b, zi) => b.zone && ORDER.indexOf(b.zone) >= zi;
  let zi = 0;
  for (let i = ORDER.length - 1; i > 0; i--){
    if (bl.reduce((a, b) => a + (at(b, i) ? b.sec : 0), 0) >= BY_KEY[ORDER[i]].minSec){ zi = i; break; }
  }
  const z = BY_KEY[ORDER[zi]];
  let work = 0, longest = 0, run = 0;
  for (const b of bl){
    if (at(b, zi)){ work += b.sec; run += b.sec; longest = Math.max(longest, run); }
    else if (!b.zone || ORDER.indexOf(b.zone) < zi) run = 0;
  }
  const f = x => Math.min(1.2, Math.pow(x, z.exp));
  const raw = 0.65 * f(work / z.refSec) + 0.35 * f(longest / z.refRep);
  return { zone: z.key, level: Math.round(Math.max(1, Math.min(10, 1 + 9 * raw)) * 10) / 10 };
}
const cache = {};
export function runSessionLevel(id){
  const s = RUN_SESSIONS[id];
  if (!s) return null;
  if (!cache[id] || cache[id].s !== s) cache[id] = { s, l: runStepsLevel(s.steps) };
  return cache[id].l;
}

// Replays runs oldest first. Returns { levels:{zone:level}, byRun:{rideId:{ zone, level, before, after }}, runs }.
export function computeRunLevels(rides){
  const levels = Object.fromEntries(ORDER.map(k => [k, 1]));
  const byRun = {};
  const runs = rides.filter(r => r.sport === 'run').sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
  const credit = (r, zone, level, bonus) => {
    const before = levels[zone], target = Math.min(10, level + bonus);
    if (target > before) levels[zone] = Math.round(target * 10) / 10;
    if (!byRun[r.id] || ORDER.indexOf(zone) > ORDER.indexOf(byRun[r.id].zone)) byRun[r.id] = { zone, level, before, after: levels[zone] };
  };
  for (const r of runs){
    const wl = r.workout_id ? runSessionLevel(r.workout_id) : null;
    if (wl){ if (r.completed !== false) credit(r, wl.zone, wl.level, FEEL_BONUS[r.feel] ?? FEEL_BONUS[3]); continue; }
    const sec = Number(r.duration_sec) || 0;
    if (sec < 300) continue;
    const IF = Number(r.intensity_factor) || 0.76;
    credit(r, 'easy', runStepsLevel([{ secs: sec, zone:'easy' }]).level, 0);
    if (IF >= 0.82) credit(r, 'steady', runStepsLevel([{ secs: sec, zone:'steady' }]).level, 0);
  }
  return { levels, byRun, runs };
}

// The library sessions a suggestion can pick from: id, session, zone, level.
export function runLibrary({ beginner = false } = {}){
  return Object.keys(RUN_SESSIONS).filter(id => /^(rl-|run-(easy|long|strides|tempo))/.test(id))
    .map(id => ({ id, s: runSession(id), l: runSessionLevel(id) }))
    .filter(x => x.s && x.l && (x.s.kind === 'beginner') === beginner)
    .map(x => ({ id: x.id, session: x.s, zone: x.l.zone, level: x.l.level, mins: x.s.mins }));
}
