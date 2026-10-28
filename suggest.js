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
import { RUN_LEVEL_ZONES, runZoneInfo, runLibrary } from './run-levels.js?v=1';
import { BEGINNER_RUNS, runSession, TT_5K } from './run.js?v=9';
import { goalPull, goalReason, relDay } from './goals.js?v=3';

export const SUGGEST_MAX_KEY = 'suggest_max_min';
export const MAX_CHOICES = [30, 45, 60, 75, 90, 120];
export const DEFAULT_MAX = 60;
const HARD = new Set(['sweet_spot', 'threshold', 'vo2max', 'anaerobic']);
const OFFSET = [-10, 0.25, 1, 2];           // target level above the rider's, by band (very tired: as easy as it gets)
const RECENT_DAYS = 10;                       // don't suggest a workout ridden this recently
const GAP_CAP = 21;
const CLOSE_SEC = 5 * 60;                    // within 5 minutes of the time picked counts as a match
const RAMP_TEST = 'prebuilt-ramp-test-25';
const REST_FORM = -18;                       // Form at or below this, with nothing else saying go, means rest

export function durationOf(w){
  if (w.duration_sec) return w.duration_sec;
  let t = 0;
  (function walk(list, n){ for (const s of list||[]){ if (s.type === 'repeat') walk(s.steps, s.repetitions||0); else t += (s.duration||0) * n; } })(w.steps, 1);
  return t;
}

// Rides without a structured workout (outdoor, logged) only tell us their overall intensity.
function zoneFromIf(f){ return f < 0.76 ? 'endurance' : f < 0.88 ? 'tempo' : f < 0.95 ? 'sweet_spot' : f < 1.02 ? 'threshold' : 'vo2max'; }
// The zone a ride counted in: its workout's, or one from its IF. Exported for goals.js (key sessions).
export function rideZone(r, byRide){
  if (byRide[r.id]) return byRide[r.id].zone;
  if ((r.sport || 'ride') !== 'ride' || r.intensity_factor == null) return null;
  return zoneFromIf(Number(r.intensity_factor));
}
const isHard = (r, byRide) => r.sport !== 'strength' && (HARD.has((byRide[r.id] || {}).zone) || Number(r.intensity_factor) >= 0.88);
const dayOf = r => isoDate(new Date(r.started_at));
const zoneName = z => zoneInfo(z).name.toLowerCase().replace('vo2 max', 'VO2');
const plural = (n, w) => Math.max(1, n) + ' ' + w + (Math.max(1, n) === 1 ? '' : 's');
const signed = n => (n > 0 ? '+' : '') + n;
// "you rode / ran / swam hard": the sport of the hard sessions, or "trained" when they were mixed.
const VERB = { ride:'rode', run:'ran', swim:'swam' };
const hardVerb = list => { const s = new Set(list.map(r => r.sport || 'ride')); return s.size === 1 ? VERB[[...s][0]] || 'trained' : 'trained'; };
// "Form is -3", or "Form tomorrow is -3" when the suggestion is for a day ahead of now.
const formIs = (form, today, now) => 'Form ' + (today > now ? (daysBetween(now, today) === 1 ? 'tomorrow ' : 'then ') : '') + 'is ' + signed(form);

// How ready the rider is going into `today`: Form and its trend, plus the band of how hard today can be
// (0 = very easy, 1 = easy, 2 = normal, 3 = fresh) and whether to rest. Today's own rides aren't counted, so a ride this morning
// doesn't change the advice. Shared by the suggested ride and the status on Progress → Fitness & form.
// now: the real date, when `today` is a day ahead (Fitness & form after training today shows tomorrow),
// so the reasons say "today" rather than "yesterday".
export function readiness({ rides, byRide = {}, today, now = today, feel = null, restDay = false }){
  const daily = new Map();
  rides.forEach(r => { const d = dayOf(r); if (r.tss != null && d < today) daily.set(d, (daily.get(d)||0) + r.tss); });
  const first = rides.reduce((m, r) => { const d = dayOf(r); return d < m ? d : m; }, today);
  const series = loadSeries(daily, first, today, today);
  const cur = series[series.length-1], weekAgo = series[Math.max(0, series.length-8)], twoWeeks = series[Math.max(0, series.length-15)];
  const form = Math.round(cur.ctl - cur.atl);
  const ramp = cur.ctl - weekAgo.ctl;
  const hardBefore = rides.filter(r => dayOf(r) === addDays(today, -1) && isHard(r, byRide));
  const yesterdayHard = hardBefore.length > 0;
  const week = rides.filter(r => dayOf(r) > addDays(today, -7) && dayOf(r) < today);
  const hardCount = week.filter(r => isHard(r, byRide)).length;
  let band = form < -25 ? 0 : form < -10 ? 1 : form <= 5 ? 2 : 3;
  const why = [];
  if (yesterdayHard){ band--; why.push('you ' + hardVerb(hardBefore) + ' hard ' + relDay(addDays(today, -1), now)); }
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
  return { form, ctl: cur.ctl, atl: cur.atl, ramp, trend: cur.ctl - twoWeeks.ctl, days: series.length,
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
// goal: the riding goal's guidance from goalGuide() (goals.js), or null. It pulls towards the goal's zones
// while key sessions are owed this week, and on the long day (length on Auto, fresh enough) it's the long ride.
// focus: { zone: weight } from focusWeights() (focus.js): what recent training is missing, added to the zone score.
// benchmark: an FTP test is due (benchmarkDue() in focus.js): on a fresh day with the length on Auto, it's the Ramp Test.
export function suggestRide({ rides, byRide = {}, levels, library, ftp, today, now = today, maxMin = 'auto', feel = null, restDay = false, goal = null, focus = null, benchmark = false }){
  if (!library || !library.length) return null;

  // 1. How hard today can be, and how long.
  const rd = readiness({ rides, byRide, today, now, feel, restDay });
  const { form, band, rest, why, lastIn, gap, hardCount } = rd;
  const tooManyHard = hardCount >= 3;
  const auto = !maxMin || maxMin === 'auto';
  const long = !!(goal && goal.long && goal.long.today && auto && band >= 2 && !rest && !restDay);
  if (auto) maxMin = long ? goal.long.mins : recommendedLength(rides, band, today);
  const maxSec = maxMin * 60;

  // 2. Which zone.
  let zones = band === 0 || long ? ['endurance'] : band === 1 || tooManyHard ? ['endurance', 'tempo'] : LEVEL_ZONES.map(z => z.key);
  const lv = LEVEL_ZONES.map(z => levels[z.key] || 1), hi = Math.max(...lv), lo = Math.min(...lv);
  const zoneScore = z => gap(z) / GAP_CAP
    + 0.5 * (hi - (levels[z] || 1)) / ((hi - lo) || 1)
    + (band === 3 && HARD.has(z) ? 0.5 : 0)
    + (z === 'endurance' && band >= 2 && maxMin <= 45 ? -0.3 : 0)   // half an hour is better spent on intervals
    + (z === 'anaerobic' ? -0.2 : 0)                                 // a sharpener, not a staple
    + goalPull(goal, z, HARD) + ((focus && focus[z]) || 0);
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
      // a long ride is about the time in the saddle, so its level counts for less
      score: Math.abs(wl.level - target) * (long ? 0.3 : 1) + off / 600 + (recent.has(w.id) ? 2 : 0) - zoneScore(wl.zone) + (band === 3 && !HARD.has(wl.zone) ? 1 : 0)
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

  // A fresh day with an old FTP: test first, so everything after it fits.
  const test = benchmark && band === 3 && auto && !rest && !long && !restDay ? library.find(w => w.id === RAMP_TEST) : null;
  if (test){
    const t = { w: test, zone:'threshold', level: levels.threshold || 1, durationSec: durationOf(test), off:0, over:false, test:true };
    picks.unshift(t);
    return { picks: picks.slice(0, 6), band, form, rest, maxMin, auto, long, test:true,
      reason: formIs(form, today, now) + ' and your FTP hasn\'t been tested for a while, so a Ramp Test: about half an hour, and every target after it fits you better.' };
  }
  const top = picks[0];
  const parts = [formIs(form, today, now)].concat(why);
  const ahead = daysBetween(now, today);   // gaps are counted to `today`; say them as of now
  if (!why.length){
    if (tooManyHard && !HARD.has(top.zone)) parts.push('you\'ve done ' + hardCount + ' hard rides this week');
    else if (top.zone !== 'endurance') parts.push(lastIn[top.zone] ? 'you haven\'t done ' + zoneName(top.zone) + ' work for ' + plural(gap(top.zone) - ahead, 'day') : 'you haven\'t done any ' + zoneName(top.zone) + ' work yet');
  }
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length-1] : parts[0];
  // Name the ride by how hard it really is for the rider: the library may not have the exact level.
  const feelWord = difficultyLabel(top.level, levels[top.zone] || 1).label.toLowerCase().replace('recovery-ish', 'easy').replace('not recommended', 'big step up');
  let reason = list + ', so ' + (long ? 'a long endurance ride.' : (/^[aeiou]/.test(feelWord) ? 'an ' : 'a ') + feelWord + ' ' + (top.w.category === 'recovery' ? 'recovery' : zoneName(top.zone)) + ' ride.');
  // Rest first: the ride is only for riders who want to ride anyway.
  if (rest) reason = 'Based on your recent fitness and form (' + list + '), we recommend a rest day. If you\'d still like to ride, keep it light: an easy spin that won\'t add to your fatigue.';
  else if (long) reason += ' ' + goalReason(goal, top.zone, { long:true });
  else {
    // The goal's sentence, when there is one, says more than the length does.
    const g = goal && band >= 1 ? goalReason(goal, top.zone) : '';
    if (g) reason += ' ' + g;
    else if (auto) reason += band === 0 ? ' Kept to ' + maxMin + ' min so you recover.' : ' ' + maxMin + ' min suits your recent riding' + (band === 1 ? ', a little shorter while you\'re tired.' : '.');
  }
  if (top.over) reason += ' ' + nearestNote(maxMin, top.durationSec);
  return { picks: picks.slice(0, 6), band, form, reason: reason.trim(), rest, maxMin, auto, long };
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

// ---- Suggested run: the same idea for running, from the run levels (run-levels.js) ----
// The length comes first (within 5 minutes), how hard from the same readiness as the ride, and which
// zone from how long since each was run and how far behind its level is; most runs stay easy, and a
// quality run (steady or faster) waits until three days after the last one. Someone who hasn't run
// (or whose Easy level is still under the first 25-minute run) gets the next step of walk/run instead.
export const RUN_CHOICES = [20, 30, 45, 60, 75, 90];
const RUN_OFFSET = [-10, 0, 0.5, 1];       // target level above the runner's, by band
const BEGINNER_BELOW = 3.8;
const QUALITY_ZONES = new Set(['steady', 'threshold', 'interval', 'fast']);                 // the level of "First 25 minute run"
export const RUN_TRY_KEY = 'run_try_dismissed';

export const isNewRunner = runLevels => !runLevels || runLevels.easy < BEGINNER_BELOW;

// What they usually run (the middle of the last four weeks), a step shorter when tired, 20 min near rest.
export function recommendedRunLength(rides, band, today){
  if (band === 0) return 20;
  const mins = rides.filter(r => r.sport === 'run' && r.duration_sec && dayOf(r) > addDays(today, -28) && dayOf(r) < today)
    .map(r => r.duration_sec / 60).sort((a, b) => a - b);
  const usual = mins.length ? mins[Math.floor(mins.length / 2)] : 30;
  let i = RUN_CHOICES.reduce((best, m, j) => Math.abs(m - usual) < Math.abs(RUN_CHOICES[best] - usual) ? j : best, 0);
  if (band === 1) i--;
  return RUN_CHOICES[Math.max(0, Math.min(RUN_CHOICES.length - 2, i))];
}

// rides: completed_rides (all sports). runLevels/byRun: from computeRunLevels(). maxMin: minutes or 'auto'.
// Returns { picks:[{ id, session, zone, level, mins, over }], band, form, reason, rest, maxMin, auto, beginner }.
// goal: the running goal's guidance from goalGuide() (goals.js), or null, used as in suggestRide(). focus: as in suggestRide().
// benchmark: a timed 5K is due (benchmarkDue() in focus.js): on a fresh day, or a good one at the weekend, it's the 5K time trial.
export function suggestRun({ rides, runLevels, byRun = {}, today, now = today, maxMin = 'auto', feel = null, restDay = false, goal = null, focus = null, benchmark = false }){
  const rd = readiness({ rides, today, now, feel, restDay });
  const { form, band, rest, why } = rd;
  const levels = Object.assign({}, runLevels || Object.fromEntries(RUN_LEVEL_ZONES.map(z => [z.key, 1])));
  // A zone never run starts a little below the Easy level, so a regular runner's first threshold
  // session isn't labelled a breakthrough.
  const tried = new Set(Object.values(byRun).map(b => b.zone));
  RUN_LEVEL_ZONES.forEach(z => { if (z.key !== 'easy' && !tried.has(z.key)) levels[z.key] = Math.max(levels[z.key], Math.round((levels.easy - 2.5) * 10) / 10); });
  const auto = !maxMin || maxMin === 'auto';
  const ran = rides.some(r => r.sport === 'run');

  // New to running: the next walk/run step (or the same one again if the last felt very hard).
  if (isNewRunner(levels)){
    const lib = runLibrary({ beginner:true });
    const steps = BEGINNER_RUNS.map((id, n) => ({ id, session: runSession(id), zone:'easy', level: (lib.find(x => x.id === id) || {}).level, step: n + 1, of: BEGINNER_RUNS.length }));
    let i = steps.findIndex(x => x.level >= levels.easy);
    if (i < 0) i = steps.length - 1;
    const picks = [steps[i]].concat(i > 0 ? [steps[i-1]] : [], i + 1 < steps.length ? [steps[i+1]] : []).map(x => Object.assign({ mins: x.session.mins, over:false }, x));
    const reason = rest ? 'Based on your recent fitness and form (Form ' + signed(form) + '), we recommend a rest day. Save your first steps of running for a fresher day.'
      : !ran ? 'Walk/run is the gentle way in: short, easy bits of running with brisk walking between. When one feels comfortable, the next one runs a little longer, building to 25 minutes non-stop.'
      : 'The next step of walk/run. If the last one felt very hard, repeat it before moving on.';
    return { picks, band, form, reason, rest, maxMin: picks[0].mins, auto, beginner: true, levels };
  }

  const long = !!(goal && goal.long && goal.long.today && auto && band >= 2 && !rest && !restDay);
  if (auto) maxMin = long ? goal.long.mins : recommendedRunLength(rides, band, today);
  const maxSec = maxMin * 60;
  const lastIn = {};
  rides.forEach(r => { const b = byRun[r.id]; if (b && (!lastIn[b.zone] || dayOf(r) > lastIn[b.zone])) lastIn[b.zone] = dayOf(r); });
  const gap = z => lastIn[z] ? Math.min(GAP_CAP, daysBetween(lastIn[z], today)) : GAP_CAP;
  const lastQuality = Object.entries(lastIn).filter(([z]) => z !== 'easy').map(([, d]) => d).sort().pop();
  const qualitySoon = lastQuality && daysBetween(lastQuality, today) < 3;
  let zones = band === 0 || rest || qualitySoon || long ? ['easy'] : band === 1 || rd.hardCount >= 3 ? ['easy', 'steady'] : RUN_LEVEL_ZONES.map(z => z.key);
  const lv = RUN_LEVEL_ZONES.map(z => levels[z.key] || 1), hi = Math.max(...lv), lo = Math.min(...lv);
  const zoneScore = z => gap(z) / GAP_CAP + 0.5 * (hi - (levels[z] || 1)) / ((hi - lo) || 1)
    + (z === 'easy' ? 0.3 : 0) + (band === 3 && z !== 'easy' && z !== 'steady' ? 0.5 : 0) + (z === 'fast' ? -0.2 : 0)
    + goalPull(goal, z, QUALITY_ZONES) + ((focus && focus[z]) || 0);
  const recent = new Set(rides.filter(r => r.sport === 'run' && r.workout_id && dayOf(r) > addDays(today, -RECENT_DAYS)).map(r => r.workout_id));
  const cands = runLibrary().filter(c => zones.includes(c.zone)).map(c => {
    const target = Math.max(1, (levels[c.zone] || 1) + RUN_OFFSET[band]);
    const off = Math.abs(c.mins * 60 - maxSec);
    return Object.assign({}, c, { off, over: off > CLOSE_SEC,
      // an easy run's level is mostly its length, so the time picked decides it, not the level
      score: Math.abs(c.level - target) * (c.zone === 'easy' ? 0.3 : 1) + off / 600 + (recent.has(c.id) ? 2 : 0) - zoneScore(c.zone)
        + (rest && c.session.kind !== 'easy' ? 3 : 0) + (long && c.session.kind !== 'long' ? 1 : 0) });
  });
  if (!cands.length) return null;
  const bucket = c => c.over ? Math.round(c.off / CLOSE_SEC) : 0;
  cands.sort((a, b) => (bucket(a) - bucket(b)) || (a.score - b.score));
  const picks = [], seen = new Set();
  for (const c of cands){ if (bucket(c) === bucket(cands[0]) && !seen.has(c.zone)){ seen.add(c.zone); picks.push(c); } }
  cands.forEach(c => { if (!picks.includes(c)) picks.push(c); });

  const wd = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
  if (benchmark && auto && !rest && !long && !qualitySoon && !restDay && (band === 3 || (band === 2 && wd >= 5))){
    const s = runSession(TT_5K);
    picks.unshift({ id: TT_5K, session: s, zone:'interval', level: levels.threshold || 1, mins: s.mins, off:0, over:false, test:true });
    return { picks: picks.slice(0, 6), band, form, rest, maxMin, auto, beginner:false, levels, long, test:true,
      reason: formIs(form, today, now) + ', so a good day to time a 5K. It sets your threshold pace' + (goal ? ', your paces and your goal prediction.' : ' and your paces.') };
  }
  const top = picks[0];
  const zn = z => runZoneInfo(z).name.toLowerCase();
  const parts = [formIs(form, today, now)].concat(why);
  const ahead = daysBetween(now, today);   // gaps are counted to `today`; say them as of now
  if (!why.length){
    if (top.zone === 'easy' && qualitySoon) parts.push('you ran hard ' + relDay(lastQuality, now));
    else if (top.zone !== 'easy') parts.push(lastIn[top.zone] ? 'you haven\'t done ' + zn(top.zone) + ' running for ' + plural(gap(top.zone) - ahead, 'day') : 'you haven\'t done any ' + zn(top.zone) + ' running yet');
  }
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length-1] : parts[0];
  const feelWord = difficultyLabel(top.level, levels[top.zone] || 1).label.toLowerCase().replace('recovery-ish', 'easy').replace('not recommended', 'big step up');
  // An easy run's level is its length, so it's just an easy run (the length is said below).
  let reason = list + ', so ' + (top.zone === 'easy' ? (top.session.kind === 'long' ? 'a long easy run.' : 'an easy run.') : (/^[aeiou]/.test(feelWord) ? 'an ' : 'a ') + feelWord + ' ' + zn(top.zone) + ' run.');
  if (rest) reason = 'Based on your recent fitness and form (' + list + '), we recommend a rest day. If you\'d still like to run, keep it short and easy.';
  else if (long) reason += ' ' + goalReason(goal, top.zone, { long:true });
  else {
    const g = goal && band >= 1 ? goalReason(goal, top.zone) : '';
    if (g) reason += ' ' + g;
    else if (auto) reason += ' ' + maxMin + ' min suits your recent running' + (band === 1 ? ', a little shorter while you\'re tired.' : '.');
  }
  if (top.over) reason += ' The nearest run to ' + maxMin + ' min is ' + top.mins + ' min.';
  return { picks: picks.slice(0, 6), band, form, reason: reason.trim(), rest, maxMin, auto, beginner: false, levels, long };
}
