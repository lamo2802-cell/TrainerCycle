// Shared rules for where each session of the followed plan falls on the calendar.
// A session's day index is days after the Monday the plan started (week*7 + weekday, Mon=0).
// A session can be moved to another date (settings key active_plan_moves: { dayIndex: 'YYYY-MM-DD' }),
// a ride saved with plan_day_index marks it done, and Skip (active_plan_cursor_day) drops every
// session with a lower day index. Accepted adaptive swaps (active_plan_swaps) are applied to the plan
// itself by applySwaps() in adapt.js. Used by plans.html, calendar.html, builder.html and live.html.

export function isoDate(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
export function parseIso(iso){
  const [y,m,d] = String(iso).slice(0,10).split('-').map(Number);
  return new Date(y, m-1, d);
}
export function addDays(iso, n){
  const d = parseIso(iso); d.setDate(d.getDate()+n); return isoDate(d);
}
export function daysBetween(fromIso, toIso){
  return Math.round((parseIso(toIso) - parseIso(fromIso)) / 86400000);
}
export function todayIso(){ return isoDate(new Date()); }

// Day 0 of the plan. Plans always start on a Monday, but older saves stored the date via toISOString(),
// which in UK summer time lands on the Sunday before; snap those forward to the Monday they meant.
export function planStart(startedAtIso){
  const d = parseIso(startedAtIso);
  const shift = (8 - d.getDay()) % 7; // Mon -> 0, Sun -> 1, Tue -> 6
  return shift ? addDays(startedAtIso, shift) : String(startedAtIso).slice(0,10);
}
export function mondayOnOrAfter(date){
  const d = new Date(date); d.setHours(0,0,0,0);
  d.setDate(d.getDate() + (8 - d.getDay()) % 7);
  return isoDate(d);
}

// Every workout session in the plan with its effective date, sorted by date.
export function planSessions(plan, startedAtIso, moves){
  startedAtIso = planStart(startedAtIso);
  const out = [];
  (plan.weeks||[]).forEach((w, wi)=> (w.days||[]).forEach((dayObj, di)=>{
    if (!dayObj || dayObj.type !== 'workout') return;
    const dayIndex = wi*7 + di;
    const planned = addDays(startedAtIso, dayIndex);
    const moved = moves && moves[dayIndex];
    out.push({ dayIndex, date: moved || planned, plannedDate: planned, moved: !!moved && moved !== planned,
      weekNum: w.week || (wi+1), deload: !!w.deload, dayObj });
  }));
  out.sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : a.dayIndex - b.dayIndex);
  return out;
}

// The next session still to ride: on or after today, not done, not skipped. null = plan finished.
export function nextSession(plan, startedAtIso, { cursorDay=0, moves=null, doneDays=null, filter=null } = {}){
  const today = todayIso();
  return planSessions(plan, startedAtIso, moves).find(s =>
    s.date >= today && s.dayIndex >= cursorDay && !(doneDays && doneDays.has(s.dayIndex)) && (!filter || filter(s))
  ) || null;
}

const FOLLOW_KEYS = ['active_plan_id','active_plan_started_at','active_plan_cursor_day','active_plan_moves','active_plan_swaps'];
export async function loadFollowState(supabase, userId){
  const { data } = await supabase.from('settings').select('key,value').eq('user_id', userId).in('key', FOLLOW_KEYS);
  const v = {}; (data||[]).forEach(r=>{ v[r.key] = r.value && r.value.v; });
  return { planId: v.active_plan_id || null, startedAt: v.active_plan_started_at || null,
    cursorDay: v.active_plan_cursor_day || 0, moves: v.active_plan_moves || {}, swaps: v.active_plan_swaps || {} };
}
export const FOLLOW_SETTING_KEYS = FOLLOW_KEYS;

// day index -> ride, for rides linked to this plan since it was started
export async function loadDoneDays(supabase, userId, planId, startedAtIso){
  const done = new Map();
  if (!planId || !startedAtIso) return done;
  const { data } = await supabase.from('completed_rides').select('id,plan_day_index,tss,started_at')
    .eq('user_id', userId).eq('plan_id', planId).gte('started_at', startedAtIso);
  (data||[]).forEach(r=>{ if (r.plan_day_index!=null) done.set(r.plan_day_index, r); });
  return done;
}

export async function saveMoves(supabase, userId, moves){
  await supabase.from('settings').upsert(
    { user_id:userId, key:'active_plan_moves', value:{v:moves}, updated_at:new Date().toISOString() },
    { onConflict:'user_id,key' }
  );
}

// Planned TSS for a workout's steps at the given FTP (hours x IF^2 x 100, IF from the steps' NP).
export function plannedTss(steps, ftp){
  let dur = 0, sumP4t = 0, hasPower = false;
  (function walk(list){
    for (const s of list||[]){
      if (s.type === 'repeat'){ for (let i=0;i<s.repetitions;i++) walk(s.steps); continue; }
      const d = s.duration||0; dur += d;
      let w = null;
      if (s.targetType === 'ftp_pct') w = ftp*(s.low+s.high)/200;
      else if (s.targetType === 'watts') w = (s.low+s.high)/2;
      if (w!=null){ sumP4t += Math.pow(w,4)*d; hasPower = true; }
    }
  })(steps);
  if (!hasPower || !dur || !(ftp>0)) return null;
  const IF = Math.pow(sumP4t/dur, 0.25) / ftp;
  return Math.round(dur * IF * IF / 36);
}
