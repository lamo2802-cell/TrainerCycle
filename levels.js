// Progression levels, TrainerRoad-style. Every structured workout gets a zone (Endurance … Anaerobic)
// and a difficulty level from 1 to 10, worked out from its steps. Each rider has a level per zone
// that rises when they complete a workout at or above it, more if it felt easy and less if it was
// all-out. Levels are recomputed from ride history each time, so nothing extra needs storing
// except the rider's "how did it feel" answer (completed_rides.feel, 1 = easy … 5 = all out).

export const LEVEL_ZONES = [
  { key:'endurance',  name:'Endurance',  short:'End', lo:56,  color:'#4C8BF5', minSec:0,    refSec:240*60, refRep:240*60 },
  { key:'tempo',      name:'Tempo',      short:'Tmp', lo:76,  color:'#3DBE7A', minSec:900,  refSec:120*60, refRep:40*60 },
  { key:'sweet_spot', name:'Sweet Spot', short:'SS',  lo:88,  color:'#C9C23A', minSec:600,  refSec:90*60,  refRep:30*60 },
  { key:'threshold',  name:'Threshold',  short:'Thr', lo:95,  color:'#E8B93D', minSec:360,  refSec:60*60,  refRep:20*60 },
  { key:'vo2max',     name:'VO2 Max',    short:'VO2', lo:106, color:'#F08A3C', minSec:180,  refSec:30*60,  refRep:5*60 },
  { key:'anaerobic',  name:'Anaerobic',  short:'Ana', lo:121, color:'#E5484D', minSec:60,   refSec:10*60,  refRep:60 },
];
const BY_KEY = Object.fromEntries(LEVEL_ZONES.map(z => [z.key, z]));
const CATEGORY_ZONE = { endurance:'endurance', tempo:'tempo', sweet_spot:'sweet_spot', threshold:'threshold', over_under:'threshold', vo2max:'vo2max', anaerobic:'anaerobic' };

export const FEEL_OPTIONS = [
  { v:1, label:'Easy',      hint:'Could have done more' },
  { v:2, label:'Moderate',  hint:'Comfortably done' },
  { v:3, label:'Hard',      hint:'Took real focus' },
  { v:4, label:'Very hard', hint:'Only just held it' },
  { v:5, label:'All out',   hint:'Nothing left' },
];
// how far above a workout's level a completed ride moves you, by feel (unanswered counts as Hard)
const FEEL_BONUS = { 1:0.4, 2:0.25, 3:0.1, 4:0, 5:-0.3 };

export function zoneInfo(key){ return BY_KEY[key] || null; }

function flatten(steps){
  let out = [];
  for (const s of steps || []){
    if (s.type === 'repeat'){ for (let i=0; i<(s.repetitions||0); i++) out = out.concat(flatten(s.steps)); }
    else out.push(s);
  }
  return out;
}
function pctOf(step, ftp){
  if (step.targetType === 'ftp_pct') return (Number(step.low) + Number(step.high)) / 2;
  if (step.targetType === 'watts' && ftp > 0) return ((Number(step.low) + Number(step.high)) / 2) / ftp * 100;
  return null; // heart-rate steps have no power target
}

// { zone, level } for a workout, or null for recovery rides, tests and free rides.
export function workoutLevel(workout, ftp){
  if (!workout || workout.category === 'recovery' || workout.category === 'test') return null;
  const flat = flatten(workout.steps).map(s => ({ dur: Number(s.duration)||0, pct: pctOf(s, ftp) })).filter(s => s.pct != null && s.dur > 0);
  if (!flat.length) return null;
  const timeAbove = lo => flat.reduce((a,s) => a + (s.pct >= lo ? s.dur : 0), 0);
  let zoneKey = CATEGORY_ZONE[workout.category];
  if (!zoneKey){
    zoneKey = 'endurance';
    for (let i = LEVEL_ZONES.length-1; i > 0; i--){
      if (timeAbove(LEVEL_ZONES[i].lo) >= LEVEL_ZONES[i].minSec){ zoneKey = LEVEL_ZONES[i].key; break; }
    }
  }
  const z = BY_KEY[zoneKey];
  // Work done at or above the zone, and the longest unbroken stretch of it.
  let work = 0, longest = 0, run = 0, intensity = 0;
  for (const s of flat){
    if (s.pct >= z.lo){ work += s.dur; intensity += s.dur * s.pct; run += s.dur; longest = Math.max(longest, run); }
    else run = 0;
  }
  if (!work) return { zone: zoneKey, level: 1 };
  const avgPct = intensity / work;
  const volume = Math.min(1.2, work / z.refSec);           // how much of it
  const length = Math.min(1.2, longest / z.refRep);        // how long each effort is
  const push = Math.max(0, (avgPct - z.lo) / 15);          // how far into (or past) the zone
  const raw = 0.55*volume + 0.30*length + 0.15*Math.min(1, push);
  const level = Math.max(1, Math.min(10, 1 + 9 * raw));
  return { zone: zoneKey, level: Math.round(level*10)/10 };
}

// Replays completed rides oldest first. `workoutFor(ride)` returns the workout row (with steps) or null.
// Returns { levels:{zoneKey:level}, byRide:{rideId:{zone, workoutLevel, before, after}} }.
export function computeLevels(rides, workoutFor, ftp){
  const levels = Object.fromEntries(LEVEL_ZONES.map(z => [z.key, 1]));
  const byRide = {};
  const sorted = [...rides].sort((a,b) => (a.started_at < b.started_at ? -1 : 1));
  for (const r of sorted){
    const w = workoutFor(r);
    // use the FTP the ride was done at (NP / IF) so "watts" workouts are judged fairly
    const rideFtp = (r.np && r.intensity_factor) ? r.np / r.intensity_factor : ftp;
    const wl = w ? workoutLevel(w, rideFtp) : null;
    if (!wl) continue;
    const before = levels[wl.zone];
    let after = before;
    if (r.completed){
      const target = Math.min(10, wl.level + (FEEL_BONUS[r.feel] ?? FEEL_BONUS[3]));
      if (target > before) after = Math.round(target*10)/10;
    }
    levels[wl.zone] = after;
    byRide[r.id] = { zone: wl.zone, workoutLevel: wl.level, before, after };
  }
  return { levels, byRide };
}

// How a workout compares with the rider's current level in its zone.
export function difficultyLabel(workoutLvl, riderLvl){
  const d = workoutLvl - riderLvl;
  if (d <= -1)  return { key:'easy',         label:'Recovery-ish' };
  if (d <= 0.5) return { key:'achievable',   label:'Achievable' };
  if (d <= 1.5) return { key:'productive',   label:'Productive' };
  if (d <= 2.5) return { key:'stretch',      label:'Stretch' };
  if (d <= 3.5) return { key:'breakthrough', label:'Breakthrough' };
  return { key:'too-hard', label:'Not recommended' };
}

export function fmtLevel(l){ return (Math.round(l*10)/10).toFixed(1); }
