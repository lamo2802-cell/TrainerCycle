// Suggested next ride. Picks the library workout that suits today best, at the length the rider
// picked: the length comes first (within 5 minutes of it), then how hard from Form (with a hard ride
// yesterday, a fast-rising Fitness, a plan rest day or the rider's "how I feel" each easing it off),
// which zone from how long since each was ridden and how far behind the rider's level is there, and
// which workout from how close its level is to the target. Nothing is ever generated: when no workout
// is that close, the nearest length is offered and the reason says so.
// The chosen length lives in settings key suggest_max_min; "how I feel" is for today only (localStorage).
import { isoDate, addDays, daysBetween } from './plan-schedule.js?v=3';
import { loadSeries } from './training-load.js?v=2';
import { workoutLevel, zoneInfo, difficultyLabel, LEVEL_ZONES } from './levels.js?v=1';

export const SUGGEST_MAX_KEY = 'suggest_max_min';
export const MAX_CHOICES = [30, 45, 60, 75, 90, 120];
export const DEFAULT_MAX = 60;
const HARD = new Set(['sweet_spot', 'threshold', 'vo2max', 'anaerobic']);
const OFFSET = [-10, 0.25, 1, 2];           // target level above the rider's, by band (very tired: as easy as it gets)
const RECENT_DAYS = 10;                       // don't suggest a workout ridden this recently
const GAP_CAP = 21;
const CLOSE_SEC = 5 * 60;                   // within 5 minutes of the time picked counts as a match

export function durationOf(w){
  if (w.duration_sec) return w.duration_sec;
  let t = 0;
  (function walk(list, n){ for (const s of list||[]){ if (s.type === 'repeat') walk(s.steps, s.repetitions||0); else t += (s.duration||0) * n; } })(w.steps, 1);
  return t;
}

// Rides without a structured workout (outdoor, logged) only tell us their overall intensity.
function zoneFromIf(f){ return f < 0.76 ? 'endurance' : f < 0.88 ? 'tempo' : f < 0.95 ? 'sweet_spot' : f < 1.02 ? 'threshold' : 'vo2max'; }
function rideZone(r, byRide){
  if (byRide[r.id]) return byRide[r.id].zone;
  if ((r.sport || 'ride') !== 'ride' || r.intensity_factor == null) return null;
  return zoneFromIf(Number(r.intensity_factor));
}
const isHard = (r, byRide) => r.sport !== 'strength' && (HARD.has((byRide[r.id] || {}).zone) || Number(r.intensity_factor) >= 0.88);
const dayOf = r => isoDate(new Date(r.started_at));
const zoneName = z => zoneInfo(z).name.toLowerCase().replace('vo2 max', 'VO2');
const signed = n => (n > 0 ? '+' : '') + n;

// rides: completed_rides (all sports), oldest first or not. byRide/levels: from computeLevels().
// library: workouts with steps. restDay: the plan has nothing today (keep it easy). feel: 'tired' | 'fresh' | null.
// Returns null when there's no history to go on or nothing in the library, else
// { picks:[{ w, zone, level, durationSec, over }], band, form, reason }; picks[0] is the suggestion.
export function suggestRide({ rides, byRide = {}, levels, library, ftp, today, maxMin = DEFAULT_MAX, feel = null, restDay = false }){
  if (!library || !library.length) return null;
  const maxSec = maxMin * 60;

  // 1. How hard today can be.
  const daily = new Map();
  // Form going into today: today's own rides aren't counted, so a ride this morning doesn't change the advice.
  rides.forEach(r => { const d = dayOf(r); if (r.tss != null && d < today) daily.set(d, (daily.get(d)||0) + r.tss); });
  const first = rides.reduce((m, r) => { const d = dayOf(r); return d < m ? d : m; }, today);
  const series = loadSeries(daily, first, today, today);
  const now = series[series.length-1], weekAgo = series[Math.max(0, series.length-8)];
  const form = Math.round(now.ctl - now.atl);
  const ramp = now.ctl - weekAgo.ctl;
  const yesterdayHard = rides.some(r => dayOf(r) === addDays(today, -1) && isHard(r, byRide));
  const week = rides.filter(r => dayOf(r) > addDays(today, -7) && dayOf(r) <= today);
  const hardCount = week.filter(r => isHard(r, byRide)).length;
  let band = form < -25 ? 0 : form < -10 ? 1 : form <= 5 ? 2 : 3;
  const why = [];
  if (yesterdayHard){ band--; why.push('you rode hard yesterday'); }
  if (ramp > 7){ band--; why.push('your Fitness is rising fast'); }
  if (feel === 'tired'){ band--; why.push('you\'re feeling tired'); }
  if (feel === 'fresh'){ band++; }
  if (restDay && band > 1){ band = 1; why.push('it\'s a rest day in your plan'); }
  band = Math.max(0, Math.min(3, band));
  const tooManyHard = hardCount >= 3;

  // 2. Which zone.
  let zones = band === 0 ? ['endurance'] : band === 1 || tooManyHard ? ['endurance', 'tempo'] : LEVEL_ZONES.map(z => z.key);
  const lastIn = {};
  rides.forEach(r => { const z = rideZone(r, byRide); if (z && (!lastIn[z] || dayOf(r) > lastIn[z])) lastIn[z] = dayOf(r); });
  const gap = z => lastIn[z] ? Math.min(GAP_CAP, daysBetween(lastIn[z], today)) : GAP_CAP;
  const lv = LEVEL_ZONES.map(z => levels[z.key] || 1), hi = Math.max(...lv), lo = Math.min(...lv);
  const zoneScore = z => gap(z) / GAP_CAP
    + 0.5 * (hi - (levels[z] || 1)) / ((hi - lo) || 1)
    + (band === 3 && HARD.has(z) ? 0.5 : 0)
    + (z === 'endurance' && band >= 2 && maxMin <= 45 ? -0.3 : 0)   // half an hour is better spent on intervals
    + (z === 'anaerobic' ? -0.2 : 0);                                // a sharpener, not a staple
  zones = zones.slice().sort((a, b) => zoneScore(b) - zoneScore(a));

  // 3 + 4. Target level and the workout.
  const recent = new Set(rides.filter(r => r.workout_id && dayOf(r) > addDays(today, -RECENT_DAYS)).map(r => r.workout_id));
  const cands = [];
  for (const w of library){
    if (!w.steps || w.category === 'test') continue;
    const d = durationOf(w);
    if (!d) continue;
    const wl = w.category === 'recovery' ? { zone:'endurance', level:1 } : workoutLevel(w, ftp);
    if (!wl || !zones.includes(wl.zone)) continue;
    if (w.category === 'recovery' && band > 0) continue;
    const target = Math.max(1, (levels[wl.zone] || 1) + OFFSET[band]);
    const off = Math.abs(d - maxSec);
    cands.push({ w, zone: wl.zone, level: wl.level, durationSec: d, off, over: off > CLOSE_SEC, recent: recent.has(w.id),
      // a fresh day is for intervals: steady zones stay on offer, behind them
      score: Math.abs(wl.level - target) + off / 600 + (recent.has(w.id) ? 2 : 0) - zoneScore(wl.zone) + (band === 3 && !HARD.has(wl.zone) ? 1 : 0) });
  }
  if (!cands.length) return null;
  // The time picked comes first: rides within 5 minutes of it, best first; then the nearest lengths.
  const bucket = c => c.over ? Math.round(c.off / CLOSE_SEC) : 0;
  cands.sort((a, b) => (bucket(a) - bucket(b)) || (a.score - b.score));
  // The best in each zone first, so "Something else" offers a different kind of ride, then the rest.
  const picks = [], seen = new Set();
  for (const c of cands){ if (bucket(c) === bucket(cands[0]) && !seen.has(c.zone)){ seen.add(c.zone); picks.push(c); } }
  cands.forEach(c => { if (!picks.includes(c)) picks.push(c); });
  // An endurance ride is always on offer as the safe choice.
  const endu = picks.findIndex(c => c.zone === 'endurance');
  if (endu > 3 && !picks[endu].over){ const [e] = picks.splice(endu, 1); picks.splice(3, 0, e); }

  const top = picks[0];
  const parts = ['Form is ' + signed(form)].concat(why);
  if (!why.length){
    if (tooManyHard && !HARD.has(top.zone)) parts.push('you\'ve done ' + hardCount + ' hard rides this week');
    else if (top.zone !== 'endurance') parts.push(lastIn[top.zone] ? 'you haven\'t done ' + zoneName(top.zone) + ' work for ' + gap(top.zone) + ' days' : 'you haven\'t done any ' + zoneName(top.zone) + ' work yet');
  }
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length-1] : parts[0];
  // Name the ride by how hard it really is for the rider: the library may not have the exact level.
  const feelWord = difficultyLabel(top.level, levels[top.zone] || 1).label.toLowerCase().replace('recovery-ish', 'easy').replace('not recommended', 'big step up');
  let reason = list + ', so ' + (/^[aeiou]/.test(feelWord) ? 'an ' : 'a ') + feelWord + ' ' + (top.w.category === 'recovery' ? 'recovery' : zoneName(top.zone)) + ' ride.';
  if (top.over) reason += ' ' + nearestNote(maxMin, top.durationSec);
  return { picks: picks.slice(0, 6), band, form, reason };
}

// The line added when no ride is within 5 minutes of the time picked.
export function nearestNote(maxMin, sec){
  return 'Nothing in the library is within 5 min of ' + maxMin + ' min, so this is the nearest length (' + Math.round(sec / 60) + ' min).';
}

// A shorter workout in the same zone for a plan session that's longer than the time the rider has:
// as close to that time as the library allows (within 5 minutes when it can), then the nearest level.
export function shorterVersion(session, library, ftp, maxMin){
  const wl = session.steps ? workoutLevel({ steps: session.steps, category: session.category }, ftp) : null;
  if (!wl) return null;
  const maxSec = maxMin * 60, own = session.durationSec || durationOf({ steps: session.steps });
  let best = null;
  for (const w of library){
    if (!w.steps || w.id === session.dayObj.workoutId || w.category === 'test' || w.category === 'recovery') continue;
    const d = durationOf(w);
    if (!d || d >= own) continue;
    const l = workoutLevel(w, ftp);
    if (!l || l.zone !== wl.zone) continue;
    const off = Math.abs(d - maxSec);
    const c = { w, zone: l.zone, level: l.level, durationSec: d, off, over: off > CLOSE_SEC };
    c.rank = (c.over ? Math.round(off / CLOSE_SEC) : 0) * 100 + Math.abs(l.level - wl.level) + off / 600;
    if (!best || c.rank < best.rank) best = c;
  }
  return best;
}

export function loadFeel(today){
  try { const v = JSON.parse(localStorage.getItem('tc_feel') || 'null'); return v && v.date === today ? v.feel : null; } catch(_){ return null; }
}
export function saveFeel(today, feel){
  try { localStorage.setItem('tc_feel', JSON.stringify({ date: today, feel })); } catch(_){}
}
export async function saveMaxMin(supabase, userId, mins){
  await supabase.from('settings').upsert({ user_id: userId, key: SUGGEST_MAX_KEY, value: { v: mins }, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
}
