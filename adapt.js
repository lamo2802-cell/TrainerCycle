// Adaptive plan tweaks. Looks at the followed plan alongside the rider's levels, how recent
// rides felt and their training load, and suggests small changes they can accept or ignore:
//   - a session missed in the last few days can move to a free day later this week
//   - an upcoming workout far above (or, when rides feel easy, below) their level in its zone
//     can swap for a library workout of similar length that's a better fit
//   - when they're very tired, the next hard session can swap for an endurance ride
//   - when they're very tired or their last two runs felt hard, the next quality run can swap for an easy run
// Accepted swaps live in settings key active_plan_swaps ({ dayIndex: workoutId }) and are
// applied to the plan with applySwaps() before anything else reads it. Suggestions the rider
// said no to are kept in plan_adapt_dismissed so they don't come back.
import { addDays, parseIso } from './plan-schedule.js?v=4';
import { workoutLevel, difficultyLabel, zoneInfo, fmtLevel } from './levels.js?v=1';
import { runSession } from './run.js?v=5';

export const SWAPS_KEY = 'active_plan_swaps';
export const DISMISSED_KEY = 'plan_adapt_dismissed';
const HARD_ZONES = ['threshold', 'vo2max', 'anaerobic'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// A copy of the plan with swapped sessions pointing at their new workout (and remembering the old one).
export function applySwaps(plan, swaps){
  if (!plan || !swaps || !Object.keys(swaps).length) return plan;
  return Object.assign({}, plan, { weeks: (plan.weeks||[]).map((w, wi)=> Object.assign({}, w, {
    days: (w.days||[]).map((d, di)=>{
      const to = swaps[wi*7 + di];
      return (d && d.type === 'workout' && to && to !== d.workoutId) ? Object.assign({}, d, { workoutId: to, swappedFrom: d.workoutId }) : d;
    })
  })) });
}

function durationOf(w){
  if (w.duration_sec) return w.duration_sec;
  let t = 0;
  (function walk(list, n){ for (const s of list||[]){ if (s.type === 'repeat') walk(s.steps, s.repetitions||0); else t += (s.duration||0) * n; } })(w.steps, 1);
  return t;
}

// Best library workout in `zone` near `target` level, about as long as `durSec`. null if nothing is a clear improvement.
export function pickAlternative(library, { zone, target, durSec, ftp, excludeId, currentLevel }){
  let best = null;
  for (const w of library){
    if (!w.steps || w.id === excludeId || w.category === 'test' || w.category === 'recovery') continue;
    const d = durationOf(w);
    if (durSec && (d < durSec*0.75 || d > durSec*1.2)) continue;
    const wl = workoutLevel(w, ftp);
    if (!wl || wl.zone !== zone) continue;
    const score = Math.abs(wl.level - target) + Math.abs(d - durSec) / 3600;
    if (!best || score < best.score) best = { w, level: wl.level, score };
  }
  if (!best) return null;
  if (currentLevel != null && Math.abs(best.level - target) > Math.abs(currentLevel - target) - 0.7) return null;
  return best;
}

function possessive(name){ return name + '\'s'; }
function dayName(iso, today){
  const diff = Math.round((parseIso(iso) - parseIso(today)) / 86400000);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday' : DAY_NAMES[parseIso(iso).getDay()];
}

// sessions: from planSessions(), each with { dayIndex, date, dayObj, isStrength, done, skipped, name, steps, durationSec }.
// rides: recent completed_rides; byRide/levels: from computeLevels(); form: today's CTL - ATL.
// away(date): optional, true on holiday days, which a missed session is never moved onto.
// Returns [{ id, kind, title, text, accept:{ type:'move'|'swap', dayIndex, date?, workoutId? }, acceptLabel }].
export function findAdaptations({ sessions, rides, levels, byRide, library, ftp, today, form, dismissed, ridToday, away }){
  const out = [];
  const no = new Set(dismissed || []);
  const live = sessions.filter(s => !s.skipped);
  const busy = new Set(live.filter(s => !s.done || s.date >= today).map(s => s.date));
  const weekEnd = addDays(today, 6 - ((parseIso(today).getDay()+6)%7)); // Sunday

  // 1. Missed in the last few days -> next free day this week.
  // Riding the same workout within a few days (but not through the plan) counts as having done it.
  const rodeAnyway = s => rides.some(r => r.plan_day_index == null && (r.workout_id === s.dayObj.workoutId || r.workout_name === s.name)
    && Math.abs(new Date(r.started_at) - parseIso(s.date)) < 3*86400000);
  const missed = live.filter(s => !s.done && s.date < today && s.date >= addDays(today, -4) && !s.isStrength && !rodeAnyway(s))
    .sort((a,b)=> a.date < b.date ? 1 : -1);
  for (const s of missed.slice(0, 1)){
    const id = 'miss:'+s.dayIndex+':'+s.date;
    if (no.has(id)) continue;
    let free = null;
    for (let d = ridToday ? addDays(today, 1) : today; d <= weekEnd; d = addDays(d, 1)){ if (!busy.has(d) && !(away && away(d))){ free = d; break; } }
    if (!free) continue;
    out.push({ id, kind:'missed', title:'You missed '+possessive(dayName(s.date, today))+' '+s.name,
      text:'You have a free day '+dayName(free, today)+'. Move it there so the week still adds up.',
      accept:{ type:'move', dayIndex:s.dayIndex, date:free }, acceptLabel:'Move to '+dayName(free, today) });
  }

  // How each zone has been going lately: struggling (very hard, all out or unfinished) or cruising (easy, moderate).
  const cutoff = Date.now() - 21*86400000;
  const zoneHistory = {};
  for (const r of rides){
    const br = byRide[r.id];
    if (!br) continue;
    const z = (zoneHistory[br.zone] = zoneHistory[br.zone] || { n:0, recent:[] });
    z.n++;
    if (new Date(r.started_at).getTime() >= cutoff) z.recent.push(r);
  }
  const lastTwo = z => (zoneHistory[z] ? zoneHistory[z].recent.slice(-2) : []);
  const struggling = z => lastTwo(z).some(r => !r.completed || (r.feel != null && r.feel >= 4));
  const cruising = z => { const t = lastTwo(z); return t.length === 2 && t.every(r => r.completed && r.feel != null && r.feel <= 2); };

  // 2. Very tired -> next hard session in the next two days becomes endurance.
  const upcoming = live.filter(s => !s.done && s.date >= today && s.date <= addDays(today, 6) && !s.isStrength && s.steps)
    .map(s => Object.assign(s, { durationSec: s.durationSec || durationOf(s) }));
  const swapped = new Set();
  if (form != null && form < -30){
    for (const s of upcoming.filter(s => s.date <= addDays(today, 1))){
      const wl = workoutLevel({ steps:s.steps, category:s.category }, ftp);
      if (!wl || !HARD_ZONES.includes(wl.zone)) continue;
      const id = 'tired:'+s.dayIndex;
      if (no.has(id)) break;
      const alt = pickAlternative(library, { zone:'endurance', target: Math.max(1, levels.endurance), durSec: s.durationSec, ftp, excludeId: s.dayObj.workoutId });
      if (!alt) break;
      out.push({ id, kind:'tired', title:'You\'re carrying a lot of fatigue',
        text:'Your form is '+Math.round(form)+'. Swap '+dayName(s.date, today)+'\'s '+s.name+' for '+alt.w.name+', an endurance ride, and come back to the hard work fresher.',
        accept:{ type:'swap', dayIndex:s.dayIndex, workoutId:alt.w.id }, acceptLabel:'Swap to '+alt.w.name });
      swapped.add(s.dayIndex);
      break;
    }
  }

  // 3. Level fit for the coming week. Only zones with some history, so new riders aren't told everything is too hard.
  let levelTweaks = 0;
  const zonesDone = new Set(); // one suggestion per zone, so the same swap isn't offered twice
  for (const s of upcoming){
    if (levelTweaks >= 2 || swapped.has(s.dayIndex) || s.dayObj.swappedFrom) continue;
    const wl = workoutLevel({ steps:s.steps, category:s.category }, ftp);
    if (!wl || wl.zone === 'endurance' || zonesDone.has(wl.zone) || !zoneHistory[wl.zone] || zoneHistory[wl.zone].n < 2) continue;
    const rider = levels[wl.zone], diff = wl.level - rider, z = zoneInfo(wl.zone);
    let target = null, why = '';
    if (diff > 2.5 || (struggling(wl.zone) && diff > 1.5)){
      target = rider + 1;
      why = struggling(wl.zone) ? 'Your last '+z.name+' rides were a real fight' : 'It\'s well above your '+z.name+' level of '+fmtLevel(rider);
    } else if (cruising(wl.zone) && diff < 0.5){
      target = rider + 1.3;
      why = 'Your last two '+z.name+' rides felt easy';
    }
    if (target == null) continue;
    const id = 'level:'+s.dayIndex+':'+s.dayObj.workoutId;
    if (no.has(id)) continue;
    const alt = pickAlternative(library, { zone:wl.zone, target, durSec:s.durationSec, ftp, excludeId:s.dayObj.workoutId, currentLevel:wl.level });
    if (!alt) continue;
    const harder = alt.level > wl.level;
    out.push({ id, kind: harder ? 'harder' : 'easier',
      title: (harder ? 'Make ' : 'Ease off ')+dayName(s.date, today)+'\'s '+s.name+(harder ? ' harder' : ''),
      text: why+'. '+alt.w.name+' ('+z.short+' '+fmtLevel(alt.level)+', '+difficultyLabel(alt.level, rider).label+') is a better fit than '+z.short+' '+fmtLevel(wl.level)+'.',
      accept:{ type:'swap', dayIndex:s.dayIndex, workoutId:alt.w.id }, acceptLabel:'Swap to '+alt.w.name });
    levelTweaks++; zonesDone.add(wl.zone);
  }

  // 4. Runs: tired, or the last two runs felt very hard -> the next quality run in the next three days becomes an easy run.
  const lastRuns = rides.filter(r => r.sport === 'run').sort((a,b)=> a.started_at < b.started_at ? -1 : 1).slice(-2);
  const runsHard = lastRuns.length === 2 && lastRuns.every(r => r.feel != null && r.feel >= 4)
    && Date.now() - new Date(lastRuns[1].started_at).getTime() < 7*86400000;
  if ((form != null && form < -30) || runsHard){
    const next = live.find(s => !s.done && s.date >= today && s.date <= addDays(today, 2) && s.dayObj.workoutType === 'run' && !s.dayObj.swappedFrom
      && (runSession(s.dayObj.workoutId) || {}).kind === 'quality');
    const id = next && 'run-tired:'+next.dayIndex;
    if (next && !no.has(id)){
      const rs = runSession(next.dayObj.workoutId);
      const mins = rs.mins >= 45 ? 50 : rs.mins >= 35 ? 40 : 30;
      const alt = runSession('run-easy-'+mins);
      out.push({ id, kind:'tired', title: runsHard ? 'Your last two runs felt really hard' : 'You\'re carrying a lot of fatigue',
        text:(runsHard ? 'Your legs may need a breather.' : 'Your form is '+Math.round(form)+'.')+' Swap '+dayName(next.date, today)+'\'s '+rs.name+' for an easy '+mins+' minute run and come back to the faster running fresher.',
        accept:{ type:'swap', dayIndex:next.dayIndex, workoutId:'run-easy-'+mins }, acceptLabel:'Swap to '+alt.name+' '+mins+' min' });
    }
  }
  return out;
}

// Persist an accepted suggestion. follow is from loadFollowState().
export async function acceptAdaptation(supabase, userId, follow, a){
  const now = new Date().toISOString();
  if (a.accept.type === 'move'){
    follow.moves = Object.assign({}, follow.moves, { [a.accept.dayIndex]: a.accept.date });
    await supabase.from('settings').upsert({ user_id:userId, key:'active_plan_moves', value:{v:follow.moves}, updated_at:now }, { onConflict:'user_id,key' });
  } else {
    follow.swaps = Object.assign({}, follow.swaps, { [a.accept.dayIndex]: a.accept.workoutId });
    await supabase.from('settings').upsert({ user_id:userId, key:SWAPS_KEY, value:{v:follow.swaps}, updated_at:now }, { onConflict:'user_id,key' });
  }
}
export async function undoSwap(supabase, userId, follow, dayIndex){
  const swaps = Object.assign({}, follow.swaps); delete swaps[dayIndex];
  follow.swaps = swaps;
  await supabase.from('settings').upsert({ user_id:userId, key:SWAPS_KEY, value:{v:swaps}, updated_at:new Date().toISOString() }, { onConflict:'user_id,key' });
}
export async function dismissAdaptation(supabase, userId, dismissed, id){
  const list = (dismissed || []).concat(id).slice(-60);
  await supabase.from('settings').upsert({ user_id:userId, key:DISMISSED_KEY, value:{v:list}, updated_at:new Date().toISOString() }, { onConflict:'user_id,key' });
  return list;
}
