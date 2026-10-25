// Calendar feed: planned sessions in Google, Apple or Outlook Calendar. The pages that build the
// followed plan (Today, Calendar) store the next eight weeks of sessions in settings key calendar_feed;
// the calendar-feed edge function serves them as an .ics feed to whoever holds the rider's secret
// link (settings key calendar_feed_token). Nothing is stored until the rider turns the feed on.
import { planSessions, todayIso, addDays, plannedTss } from './plan-schedule.js?v=3';
import { runSession } from './run.js?v=3';

export const FEED_TOKEN_KEY = 'calendar_feed_token';
export const FEED_KEY = 'calendar_feed';
export const FEED_URL = 'https://uqevjhysxzkivmjwggvu.supabase.co/functions/v1/calendar-feed';
const WEEKS_AHEAD = 8;

const mins = sec => Math.round((sec || 0) / 60);
function durOf(steps){ let t = 0; (function walk(l, n){ for (const s of l || []){ if (s.type === 'repeat') walk(s.steps, s.repetitions || 0); else t += (s.duration || 0) * n; } })(steps, 1); return t; }

// plan: the followed plan as the rider sees it (runs, swaps and holidays applied).
export function feedEvents(plan, follow, workouts, ftp){
  if (!plan || !follow || !follow.startedAt) return [];
  const today = todayIso(), end = addDays(today, WEEKS_AHEAD * 7);
  return planSessions(plan, follow.startedAt, follow.moves)
    .filter(s => s.date >= today && s.date <= end && s.dayIndex >= (follow.cursorDay || 0))
    .map(s => {
      const d = s.dayObj;
      if (d.workoutType === 'run'){
        const r = runSession(d.workoutId);
        return r && { date:s.date, title:'Run: '+r.name, text:r.mins+' min · '+r.tss+' TSS. '+r.text, url:'https://trainercycle.com/trainerrun.html' };
      }
      const w = workouts[d.workoutId] || {};
      if (d.workoutType === 'strength') return { date:s.date, title:'Strength: '+(w.name || 'session'), text:'TrainerStrength session.', url:'https://trainercycle.com/trainerstrength.html?load='+encodeURIComponent(d.workoutId) };
      const tss = w.steps ? plannedTss(w.steps, ftp) : null;
      const m = mins(w.duration_sec || durOf(w.steps));
      return { date:s.date, title:'Ride: '+(w.name || d.workoutId), text:(m ? m+' min' : '')+(tss != null ? ' · '+tss+' TSS' : '')+(d.holiday ? '. Easy version while you\'re away.' : '.'),
        url:'https://trainercycle.com/live.html?load='+encodeURIComponent(d.workoutId) };
    }).filter(Boolean);
}

// Store the events when the feed is on and they've changed since this device last stored them.
let feedOn = null; // one lookup per page load
export async function syncCalendarFeed(supabase, userId, events, { force = false } = {}){
  try {
    if (feedOn == null || force) feedOn = supabase.from('settings').select('value').eq('user_id', userId).eq('key', FEED_TOKEN_KEY).maybeSingle()
      .then(r => !!(r.data && r.data.value && r.data.value.v));
    if (!(await feedOn)) return;
    const body = JSON.stringify(events);
    const memo = 'tc_calfeed_' + userId;
    let last = null; try { last = localStorage.getItem(memo); } catch(_){}
    if (last === body && !force) return;
    await supabase.from('settings').upsert({ user_id:userId, key:FEED_KEY, value:{ v:events }, updated_at:new Date().toISOString() }, { onConflict:'user_id,key' });
    try { localStorage.setItem(memo, body); } catch(_){}
  } catch(_){ /* the feed is a nicety; never break the page over it */ }
}

export function feedLink(token){ return FEED_URL + '?token=' + encodeURIComponent(token); }
