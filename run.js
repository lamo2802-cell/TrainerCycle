// Running alongside the bike. Runs are stored in completed_rides with sport = 'run' so they count in
// training load, streaks and the calendar like any ride. Run TSS (rTSS) works like bike TSS:
// hours x IF^2 x 100, with IF = threshold pace / run pace. Without a distance (or a threshold pace)
// IF comes from how the run felt instead. Threshold pace lives in settings key run_threshold_pace
// (seconds per km).

import { showSheet, notify } from './sheet.js?v=2';

export const RUN_PACE_KEY = 'run_threshold_pace';
export const RUN_PLAN_KEY = 'active_plan_runs';

// How hard a run felt -> intensity factor, used when pace can't be worked out.
const FEEL_IF = { 1:0.68, 2:0.76, 3:0.85, 4:0.92, 5:1.0 };

// Run sessions a plan can include. IF is the session's typical intensity, used for planned TSS.
export const RUN_SESSIONS = {
  'run-easy-30':   { name:'Easy run',            mins:30, IF:0.72, kind:'easy',      text:'Conversational pace the whole way. You should be able to talk in full sentences.' },
  'run-easy-40':   { name:'Easy run',            mins:40, IF:0.72, kind:'easy',      text:'Conversational pace the whole way. You should be able to talk in full sentences.' },
  'run-strides-35':{ name:'Easy run + strides',  mins:35, IF:0.75, kind:'easy',      text:'30 min easy, then 6 × 20 s quick, relaxed strides with a full walk back between each.' },
  'run-tempo-40':  { name:'Tempo run',           mins:40, IF:0.85, kind:'tempo',     text:'10 min easy, 3 × 6 min at threshold pace with 2 min jog between, then easy to finish.' },
  'run-long-60':   { name:'Long run',            mins:60, IF:0.74, kind:'long',      text:'Steady and easy. Keep the effort low enough that the last 10 minutes feel as controlled as the first.' },
  'run-long-75':   { name:'Long run',            mins:75, IF:0.74, kind:'long',      text:'Steady and easy. Keep the effort low enough that the last 10 minutes feel as controlled as the first.' },
};
export function runSession(id){ return RUN_SESSIONS[id] || null; }
export function plannedRunTss(id){ const s = RUN_SESSIONS[id]; return s ? Math.round(s.mins/60 * s.IF*s.IF * 100) : null; }

// "4:45" / "4.45" / "445" -> 285 seconds. null if it doesn't look like a pace.
export function parsePace(str){
  const m = String(str||'').trim().match(/^(\d{1,2})[:.](\d{2})$/) || String(str||'').trim().match(/^(\d{1,2})(\d{2})$/);
  if (!m) return null;
  const s = Number(m[1])*60 + Number(m[2]);
  return (Number(m[2]) < 60 && s >= 120 && s <= 900) ? s : null;
}
// "22:30" or "1:02:30" -> seconds.
export function parseDuration(str){
  const parts = String(str||'').trim().split(':').map(Number);
  if (!parts.length || parts.some(n => isNaN(n))) return null;
  if (parts.length === 1) return parts[0] > 0 ? Math.round(parts[0]*60) : null; // plain minutes
  const s = parts.reduce((a,n)=> a*60 + n, 0);
  return s > 0 ? s : null;
}
export function fmtPace(secPerKm){
  if (!secPerKm) return '—';
  const s = Math.round(secPerKm);
  return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
}
export function fmtKm(m){ return m ? (m/1000).toFixed(m < 10000 ? 2 : 1) : '—'; }

// A recent 5K race time -> threshold pace. A 5K is run at roughly 104% of threshold speed.
export function thresholdFrom5k(sec){ return sec ? Math.round(sec/5 * 1.04) : null; }

export function runIf({ durationSec, distanceM, thresholdPace, feel }){
  if (durationSec > 0 && distanceM > 0 && thresholdPace > 0){
    const pace = durationSec / (distanceM/1000);
    return Math.max(0.4, Math.min(1.15, thresholdPace / pace));
  }
  return FEEL_IF[feel] || 0.76;
}
export function runTss(opts){
  if (!(opts.durationSec > 0)) return null;
  const IF = runIf(opts);
  return Math.round(opts.durationSec/3600 * IF*IF * 100);
}

// Adds the rider's chosen run days to a plan (cfg = { days:[0..6 Mon..Sun] }). Runs only go on rest days:
// the first run day each week is an easy run, the second a long run (both shorter in a deload week),
// and a third is easy with strides.
export function addRuns(plan, cfg){
  const days = cfg && Array.isArray(cfg.days) ? [...cfg.days].sort((a,b)=>a-b) : [];
  if (!plan || !days.length) return plan;
  return Object.assign({}, plan, { weeks: (plan.weeks||[]).map(w => {
    const out = (w.days||[]).slice();
    let n = 0;
    for (const di of days){
      const d = out[di];
      if (!d || d.type !== 'rest') continue;
      const id = w.deload ? (n === 1 ? 'run-easy-40' : 'run-easy-30')
        : n === 0 ? 'run-easy-40' : n === 1 ? (w.week > 2 ? 'run-long-75' : 'run-long-60') : 'run-strides-35';
      out[di] = { day: d.day, type:'workout', workoutType:'run', workoutId:id };
      n++;
    }
    return Object.assign({}, w, { days: out });
  }) });
}

// Saves a run. session (optional) is a plan session to mark as done.
export async function saveRun(supabase, userId, { name, startedAt, durationSec, distanceM, feel, thresholdPace, plan, dayIndex }){
  const record = {
    id: 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8),
    user_id: userId, sport:'run', source:'manual', category:'run',
    workout_name: name || 'Run', started_at: startedAt, duration_sec: Math.round(durationSec),
    distance_m: distanceM ? Math.round(distanceM) : null,
    tss: runTss({ durationSec, distanceM, thresholdPace, feel }),
    intensity_factor: Math.round(runIf({ durationSec, distanceM, thresholdPace, feel })*100)/100,
    feel: feel || null, completed: true, samples: [],
    plan_id: plan || null, plan_day_index: dayIndex != null ? dayIndex : null,
  };
  const { error } = await supabase.from('completed_rides').insert(record);
  if (error) throw error;
  return record;
}

// ---- "Log a run" sheet ----

const LOG_CSS = `
.rl-form{ display:grid; gap:12px; margin:6px 0 2px; }
.rl-form label{ display:block; font-size:12px; color:#8B96A5; margin-bottom:5px; text-transform:uppercase; letter-spacing:.05em; }
.rl-form input{ width:100%; box-sizing:border-box; padding:11px 12px; border-radius:9px; border:1px solid #2A323D; background:#11161D; color:#E7ECF2; font:inherit; font-size:15px; margin:0; }
.rl-row{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.rl-feel{ display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; }
.rl-feel button{ width:auto; margin:0; padding:9px 2px; border-radius:9px; border:1px solid #2A323D; background:#1D242D; color:#E7ECF2; font:inherit; font-size:12px; font-weight:600; cursor:pointer; }
.rl-feel button.on{ border-color:#45D6C4; background:rgba(69,214,196,.14); }
.rl-sum{ font-size:13px; color:#B4BDC9; font-family:'JetBrains Mono',ui-monospace,monospace; min-height:18px; }
.rl-sum b{ color:#E7ECF2; }
.rl-note{ font-size:13px; color:#B4BDC9; line-height:1.45; margin:0; background:#11161D; border:1px solid #2A323D; border-radius:9px; padding:10px 12px; }
`;
function localIso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// session: optional { dayIndex, date, workoutId } of a planned run, with planId. Resolves with the saved record, or null.
export async function openRunLog(supabase, userId, { session = null, planId = null } = {}){
  if (!document.getElementById('rl-style')){ const st = document.createElement('style'); st.id = 'rl-style'; st.textContent = LOG_CSS; document.head.appendChild(st); }
  let thresholdPace = null;
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', RUN_PACE_KEY).eq('user_id', userId).maybeSingle();
    if (data && data.value && data.value.v) thresholdPace = Number(data.value.v);
  } catch(_){}
  const planned = session ? runSession(session.workoutId) : null;
  const today = localIso(new Date());
  const date = session && session.date <= today ? session.date : today;
  const form = document.createElement('div');
  form.className = 'rl-form';
  form.innerHTML = (planned ? '<p class="rl-note">'+planned.text+'</p>' : '')
    + '<div><label for="rlName">Name</label><input id="rlName" value="'+(planned ? planned.name : 'Run')+'"></div>'
    + '<div class="rl-row"><div><label for="rlDate">Date</label><input id="rlDate" type="date" max="'+today+'" value="'+date+'"></div>'
    + '<div><label for="rlTime">Time (min or h:mm:ss)</label><input id="rlTime" inputmode="numeric" placeholder="'+(planned ? planned.mins : 40)+'"'+(planned ? ' value="'+planned.mins+'"' : '')+'></div></div>'
    + '<div><label for="rlDist">Distance (km, optional)</label><input id="rlDist" inputmode="decimal" placeholder="e.g. 8.2"></div>'
    + '<div><label>How did it feel?</label><div class="rl-feel">'+['Easy','Moderate','Hard','Very hard','All out'].map((l,i)=>'<button type="button" data-v="'+(i+1)+'">'+l+'</button>').join('')+'</div></div>'
    + '<div class="rl-sum" id="rlSum"></div>';
  let feel = null;
  const val = id => form.querySelector('#'+id).value;
  function read(){
    const durationSec = parseDuration(val('rlTime'));
    const km = parseFloat(String(val('rlDist')).replace(',', '.'));
    const distanceM = km > 0 ? km*1000 : null;
    return { durationSec, distanceM };
  }
  function summary(){
    const { durationSec, distanceM } = read();
    const el = form.querySelector('#rlSum');
    if (!durationSec){ el.textContent = ''; return; }
    const tss = runTss({ durationSec, distanceM, thresholdPace, feel });
    el.innerHTML = (distanceM ? '<b>'+fmtPace(durationSec/(distanceM/1000))+'</b> /km · ' : '') + '<b>'+tss+'</b> TSS'
      + (!thresholdPace && distanceM ? ' · set a threshold pace in Settings for pace-based TSS' : '');
  }
  form.addEventListener('input', summary);
  form.querySelector('.rl-feel').addEventListener('click', e=>{
    const b = e.target.closest('[data-v]'); if (!b) return;
    feel = Number(b.dataset.v);
    form.querySelectorAll('.rl-feel button').forEach(x=> x.classList.toggle('on', x === b));
    summary();
  });
  summary();
  let saved = null;
  await showSheet({ title: planned ? 'Log '+planned.name.toLowerCase() : 'Log a run', content: form,
    buttons:[{ label:'Save run', value:'save', kind:'primary' }, { label:'Cancel', value:null }],
    onAction: async ()=>{
      const { durationSec, distanceM } = read();
      if (!durationSec){ form.querySelector('#rlTime').focus(); form.querySelector('#rlSum').textContent = 'Enter how long you ran for.'; return false; }
      const d = val('rlDate') || today;
      const startedAt = d === today ? new Date(Date.now() - durationSec*1000).toISOString() : new Date(d+'T12:00:00').toISOString();
      try {
        saved = await saveRun(supabase, userId, { name: val('rlName').trim() || 'Run', startedAt, durationSec, distanceM, feel, thresholdPace,
          plan: session ? planId : null, dayIndex: session ? session.dayIndex : null });
      } catch(e){
        await notify('Check your connection and try again.', 'Couldn\'t save that run');
        return false;
      }
    } });
  return saved;
}

// ---- Strava run import ----
// Pulls new runs from Strava (at most every 30 minutes unless forced). Resolves with
// { imported: [rows], needsReconnect } and never throws: import is a background nicety.
// Pulls in runs and outside rides from Strava (the strava-import function skips anything already here).
export async function syncStrava(supabase, userId, { force = false } = {}){
  const key = 'tc_strava_sync_' + userId;
  try { if (!force && Date.now() - Number(localStorage.getItem(key) || 0) < 30*60000) return { imported: [], skipped: true }; } catch(_){}
  try {
    const { data, error } = await supabase.functions.invoke('strava-import', { body: {} });
    if (error) return { imported: [] };
    try { localStorage.setItem(key, String(Date.now())); } catch(_){}
    return { imported: (data && data.imported) || [], needsReconnect: !!(data && data.needsReconnect) };
  } catch(_){ return { imported: [] }; }
}

export const syncStravaRuns = syncStrava;

// Marks planned run sessions done by imported runs on the same day. sessions: from planSessions(),
// with isRun/done set. Returns how many were linked.
export async function linkRunsToPlan(supabase, runs, sessions, planId){
  let n = 0;
  for (const r of runs){
    if (r.sport !== 'run') continue;
    const day = localIso(new Date(r.started_at));
    const s = sessions.find(x => x.isRun && !x.done && x.date === day);
    if (!s) continue;
    const { error } = await supabase.from('completed_rides').update({ plan_id: planId, plan_day_index: s.dayIndex }).eq('id', r.id);
    if (!error){ s.done = true; n++; }
  }
  return n;
}
