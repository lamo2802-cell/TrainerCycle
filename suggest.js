// Suggested next ride. Picks the library workout that suits today best, at the length the rider
// picked: the length comes first (within 5 minutes of it), then how hard from Form (with a hard ride
// yesterday, a fast-rising Fitness, a plan rest day or the rider's "how I feel" each easing it off),
// which zone from how long since each was ridden and how far behind the rider's level is there, and
// which workout from how close its level is to the target. Nothing is ever generated: when no workout
// is that close, the nearest length is offered and the reason says so.
// The length defaults to the recommended one (recommendedLength()); a length the rider picks and "how I feel"
// are for today only (localStorage). Settings key suggest_max_min is the old saved length, no longer read on Today.
import { isoDate, addDays, daysBetween } from './plan-schedule.js?v=6';
import { loadSeries } from './training-load.js?v=2';
import { workoutLevel, zoneInfo, difficultyLabel, LEVEL_ZONES } from './levels.js?v=1';

export const SUGGEST_MAX_KEY = 'suggest_max_min';
export const MAX_CHOICES = [30, 45, 60, 75, 90, 120];
export const DEFAULT_MAX = 60;
const HARD = new Set(['sweet_spot', 'threshold', 'vo2max', 'anaerobic']);
const OFFSET = [-10, 0.25, 1, 2];           // target level above the rider's, by band (very tired: as easy as it gets)
const RECENT_DAYS = 10;                       // don't suggest a workout ridden this recently
const GAP_CAP = 21;
const CLOSE_SEC = 5 * 60;
const REST_FORM = -18;                      // Form at or below this, with nothing else saying go, means rest                   // within 5 minutes of the time picked counts as a match

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

// How ready the rider is going into `today`: Form and its trend, plus the band of how hard today can be
// (0 = very easy, 1 = easy, 2 = normal, 3 = fresh) and whether to rest. Today's own rides aren't counted, so a ride this morning
// doesn't change the advice. Shared by the suggested ride and the status on Progress → Fitness & form.
export function readiness({ rides, byRide = {}, today, feel = null, restDay = false }){
  const daily = new Map();
  rides.forEach(r => { const d = dayOf(r); if (r.tss != null && d < today) daily.set(d, (daily.get(d)||0) + r.tss); });
  const first = rides.reduce((m, r) => { const d = dayOf(r); return d < m ? d : m; }, today);
  const series = loadSeries(daily, first, today, today);
  const now = series[series.length-1], weekAgo = series[Math.max(0, series.length-8)], twoWeeks = series[Math.max(0, series.length-15)];
  const form = Math.round(now.ctl - now.atl);
  const ramp = now.ctl - weekAgo.ctl;
  const yesterdayHard = rides.some(r => dayOf(r) === addDays(today, -1) && isHard(r, byRide));
  const week = rides.filter(r => dayOf(r) > addDays(today, -7) && dayOf(r) < today);
  const hardCount = week.filter(r => isHard(r, byRide)).length;
  let band = form < -25 ? 0 : form < -10 ? 1 : form <= 5 ? 2 : 3;
  const why = [];
  if (yesterdayHard){ band--; why.push('you rode hard yesterday'); }
  if (ramp > 7){ band--; why.push('your Fitness is rising fast'); }
  if (feel === 'tired'){ band--; why.push('you\'re feeling tired'); }
  if (feel === 'fresh'){ band++; }
  if (restDay && band > 1){ band = 1; why.push('it\'s a rest day in your plan'); }
  band = Math.max(0, Math.min(3, band));
  // Rest is advised only when the fatigue is real: the easiest band and Form well below zero.
  // A merely tired day (say Form -12 after a hard ride) gets an easy ride instead.
  const rest = band === 0 && form <= REST_FORM;
  const lastIn = {};
  rides.forEach(r => { const z = rideZone(r, byRide); if (z && (!lastIn[z] || dayOf(r) > lastIn[z])) lastIn[z] = dayOf(r); });
  const gap = z => lastIn[z] ? Math.min(GAP_CAP, daysBetween(lastIn[z], today)) : GAP_CAP;
  return { form, ctl: now.ctl, atl: now.atl, ramp, trend: now.ctl - twoWeeks.ctl, days: series.length,
    band, rest, why, yesterdayHard, hardCount, lastIn, gap,
    sinceLast: rides.length ? daysBetween(rides.reduce((m, r) => { const d = dayOf(r); return d > m && d < today ? d : m; }, first), today) : null };
}

// The length to ride when the rider hasn't picked one: what they usually ride (the middle of their last
// four weeks of rides), a step shorter when tired and half an hour when rest is advised.
export function recommendedLength(rides, band, today){
  if (band === 0) return 30;   // a rest day, or close to one
  const mins = rides.filter(r => (r.sport || 'ride') === 'ride' && r.duration_sec && dayOf(r) > addDays(today, -28) && dayOf(r) < today)
    .map(r => r.duration_sec / 60).sort((a, b) => a - b);
  const usual = mins.length ? mins[Math.floor(mins.length / 2)] : DEFAULT_MAX;
  let i = MAX_CHOICES.reduce((best, m, j) => Math.abs(m - usual) < Math.abs(MAX_CHOICES[best] - usual) ? j : best, 0);
  if (band === 1) i--;
  return MAX_CHOICES[Math.max(0, Math.min(MAX_CHOICES.length - 2, i))];   // two hours only when asked for
}

// Plain-language read of where the rider is: { key, title, text }.
// key: 'new' | 'rest' | 'improving' | 'maintaining' | 'declining' | 'break'.
export function trainingStatus(rd){
  const n = Math.round(Math.abs(rd.trend));
  const pts = n + (n === 1 ? ' point' : ' points');
  const formTxt = 'Form ' + signed(rd.form);
  if (rd.days < 21 || rd.ctl < 5) return { key:'new', title:'Getting started',
    text:'Keep riding for a few weeks and we\'ll tell you whether you\'re improving. Every ride adds to your Fitness.' };
  if (rd.rest) return { key:'rest', title:'Fatigued: time to rest',
    text:'Your recent training has built up more fatigue than your fitness can absorb (' + formTxt + (rd.why.length ? ', and ' + rd.why.join(' and ') : '') + '). A rest day now lets your body adapt, so you come back stronger.' };
  if (rd.sinceLast != null && rd.sinceLast > 10) return { key:'break', title:'Time off the bike',
    text:'It\'s been ' + rd.sinceLast + ' days since your last ride, so your Fitness is slipping. You\'re fresh: start back with a couple of steady rides.' };
  if (rd.trend >= 2){
    const tail = rd.ramp > 7 ? ' That\'s a fast climb, so keep your easy days easy.'
      : rd.form < -10 ? ' You\'re carrying some fatigue, which is normal while you build.'
      : rd.form > 5 ? ' You\'re fresh too, so you\'re ready for a hard session.' : '';
    return { key:'improving', title:'Improving', text:'Your Fitness is up ' + pts + ' over the last two weeks.' + tail };
  }
  if (rd.trend <= -2) return { key:'declining', title:'Losing a little fitness',
    text:'Your Fitness is down ' + pts + ' over the last two weeks' + (rd.form > 5 ? ', but you\'re fresh: a good time for a hard session or an FTP test.' : '. A little more riding each week will turn it around.') };
  return { key:'maintaining', title:'Maintaining',
    text:'Your Fitness is steady over the last two weeks' + (rd.form < -10 ? ', and you\'re a bit tired.' : '.') + ' To keep improving, add a little more riding each week.' };
}

// The time picked on Today is for today only: tomorrow goes back to the recommended length.
export function loadLength(today){
  try { const v = JSON.parse(localStorage.getItem('tc_suggest_len') || 'null'); return v && v.date === today ? v.v : null; } catch(_){ return null; }
}
export function saveLength(today, v){
  try { localStorage.setItem('tc_suggest_len', JSON.stringify({ date: today, v })); } catch(_){}
}

// rides: completed_rides (all sports), oldest first or not. byRide/levels: from computeLevels().
// library: workouts with steps. restDay: the plan has nothing today (keep it easy). feel: 'tired' | 'fresh' | null.
// maxMin: minutes, or 'auto' for the recommended length (recommendedLength()).
// Returns null when there's no history to go on or nothing in the library, else
// { picks:[{ w, zone, level, durationSec, over }], band, form, reason, rest, maxMin, auto }; picks[0] is the suggestion.
// rest: rest is advised and the picks are easy spins for riding anyway.
export function suggestRide({ rides, byRide = {}, levels, library, ftp, today, maxMin = 'auto', feel = null, restDay = false }){
  if (!library || !library.length) return null;

  // 1. How hard today can be, and how long.
  const rd = readiness({ rides, byRide, today, feel, restDay });
  const { form, band, rest, why, lastIn, gap, hardCount } = rd;
  const tooManyHard = hardCount >= 3;
  const auto = !maxMin || maxMin === 'auto';
  if (auto) maxMin = recommendedLength(rides, band, today);
  const maxSec = maxMin * 60;

  // 2. Which zone.
  let zones = band === 0 ? ['endurance'] : band === 1 || tooManyHard ? ['endurance', 'tempo'] : LEVEL_ZONES.map(z => z.key);
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
      // a fresh day is for intervals: steady zones stay on offer, behind them; a rest day is for a recovery spin
      score: Math.abs(wl.level - target) + off / 600 + (recent.has(w.id) ? 2 : 0) - zoneScore(wl.zone) + (band === 3 && !HARD.has(wl.zone) ? 1 : 0)
        + (rest && w.category !== 'recovery' ? 3 : 0) });
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
  // Rest first: the ride is only for riders who want to ride anyway.
  if (rest) reason = 'Based on your recent fitness and form (' + list + '), we recommend a rest day. If you\'d still like to ride, keep it light: an easy spin that won\'t add to your fatigue.';
  else if (auto) reason += band === 0 ? ' Kept to ' + maxMin + ' min so you recover.' : ' ' + maxMin + ' min suits your recent riding' + (band === 1 ? ', a little shorter while you\'re tired.' : '.');
  if (top.over) reason += ' ' + nearestNote(maxMin, top.durationSec);
  return { picks: picks.slice(0, 6), band, form, reason, rest, maxMin, auto };
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

// Other workouts for a plan session, each the same length as it (within 5 minutes), so swapping one in
// keeps the day the same size: the closest in the session's own zone first, then easier ones (a lower
// zone, for when the legs aren't there) and one a step harder. Returns
// [{ w, zone, level, durationSec, group:'same'|'easier'|'harder' }], same first.
const ZONE_ORDER = LEVEL_ZONES.map(z => z.key);
export function alternativesFor(session, library, ftp){
  const wl = session.steps ? workoutLevel({ steps: session.steps, category: session.category }, ftp) : null;
  if (!wl) return [];
  const own = session.durationSec || durationOf({ steps: session.steps });
  const zi = ZONE_ORDER.indexOf(wl.zone);
  const skip = new Set([session.dayObj.workoutId, session.dayObj.swappedFrom]);
  const cands = [];
  for (const w of library){
    if (!w.steps || skip.has(w.id) || w.category === 'test') continue;
    const d = durationOf(w);
    if (!d || Math.abs(d - own) > CLOSE_SEC) continue;
    const l = w.category === 'recovery' ? { zone:'endurance', level:1 } : workoutLevel(w, ftp);
    if (!l) continue;
    const oi = ZONE_ORDER.indexOf(l.zone);
    const group = w.category === 'recovery' && session.category !== 'recovery' ? 'easier' : oi === zi ? 'same' : oi < zi ? 'easier' : 'harder';
    cands.push({ w, zone: l.zone, level: l.level, durationSec: d, group, oi,
      rank: Math.abs(oi - zi) * 3 + Math.abs(l.level - wl.level) + Math.abs(d - own) / 600 });
  }
  cands.sort((a, b) => a.rank - b.rank);
  const pick = (group, n, onePerZone) => {
    const out = [], zones = new Set();
    for (const c of cands){
      if (c.group !== group || out.length >= n || (onePerZone && zones.has(c.zone))) continue;
      zones.add(c.zone); out.push(c);
    }
    return out;
  };
  return pick('same', 3).concat(pick('easier', 2, true), pick('harder', 1));
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
