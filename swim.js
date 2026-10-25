// Swimming. Swims are stored in completed_rides with sport = 'swim' (category 'pool' or 'open_water')
// so they count in training load, streaks and the calendar like rides and runs. Swim TSS works from
// CSS (critical swim speed, the swimming version of FTP) in seconds per 100 m, settings key swim_css:
// IF = CSS pace / swim pace, and sTSS = hours x IF^3 x 100 (cubed, because water resistance rises
// steeply with speed). Without a distance (or a CSS) IF comes from how the swim felt instead.

import { showSheet, notify } from './sheet.js?v=2';
import { parseDuration } from './run.js?v=4';

export const SWIM_CSS_KEY = 'swim_css';

const FEEL_IF = { 1:0.70, 2:0.78, 3:0.86, 4:0.93, 5:1.0 };
const DEFAULT_CSS = 120; // 2:00/100 m, for estimating how long a session takes when no CSS is set

// Swim zones as seconds per 100 m slower (+) or faster (-) than CSS pace, and their typical IF.
export const SWIM_ZONES = [
  { id:'easy',   name:'Easy',   lo:12, hi:18, IF:0.74, color:'#4C8BF5', feel:'Long, relaxed strokes. Warm-ups, cool-downs and recovery.' },
  { id:'drill',  name:'Drill',  lo:15, hi:25, IF:0.65, color:'#5A6472', feel:'Technique work. Slow and precise, not about pace.' },
  { id:'steady', name:'Steady', lo:5,  hi:9,  IF:0.86, color:'#3DBE7A', feel:'Aerobic endurance: a pace you could hold for a long swim.' },
  { id:'css',    name:'CSS',    lo:-1, hi:2,  IF:1.00, color:'#E8B93D', feel:'Threshold: hard but even, the pace you could hold for about 30 minutes.' },
  { id:'fast',   name:'Fast',   lo:-7, hi:-3, IF:1.07, color:'#E5484D', feel:'Short and quick, with good form.' },
];
const ZONE_BY_ID = Object.fromEntries(SWIM_ZONES.map(z => [z.id, z]));
export function swimZonePaces(zoneId, css){ const z = ZONE_BY_ID[zoneId]; return z && css ? [css + z.lo, css + z.hi] : null; }

let swimCss = null; // the swimmer's CSS, so session descriptions can show real paces
export function setSwimCss(v){ swimCss = Number(v) || null; }

// Swim sessions are lists of steps: { m, zone, reps?, rest? (seconds), what? ('drill'|'kick'|'pull'|'build') }.
// Built-in sessions below; plans register more (see plan-kit.js).
export const SWIM_SESSIONS = {
  'swim-easy-1500': { name:'Easy swim', kind:'easy', blurb:'Relaxed and smooth. Mix in some backstroke if you like.',
    steps:[{ m:300, zone:'easy' }, { m:900, zone:'easy' }, { m:300, zone:'easy' }] },
};
export function registerSwimSession(id, spec){ SWIM_SESSIONS[id] = spec; }

function stepTime(st, css){
  const z = ZONE_BY_ID[st.zone] || ZONE_BY_ID.easy;
  const pace = (css || DEFAULT_CSS) + (z.lo + z.hi)/2;
  const n = st.reps || 1;
  return { work: st.m/100 * pace * n, rest: (st.rest || 0) * Math.max(0, n-1), IF: z.IF };
}
// Duration (seconds), distance (metres) and planned TSS of a session.
export function swimLoad(spec, css = swimCss){
  let secs = 0, tss = 0, metres = 0;
  for (const st of spec.steps || []){
    const { work, rest, IF } = stepTime(st, css);
    secs += work + rest;
    metres += st.m * (st.reps || 1);
    tss += work/3600 * Math.pow(IF, 3) * 100 + rest/3600 * Math.pow(0.4, 3) * 100;
  }
  return { secs: Math.round(secs), metres, tss: Math.round(tss) };
}
const WHAT = { drill:'drill', kick:'kick', pull:'pull buoy', build:'build' };
// "300 easy, then 8 × 100 at CSS (1:52–1:55/100 m) on 15 s rest, then 200 easy"
export function describeSwim(spec, css = swimCss){
  const parts = (spec.steps || []).map(st => {
    const p = st.zone === 'drill' ? null : swimZonePaces(st.zone, css);
    const zn = st.zone === 'css' ? 'at CSS' : st.zone === 'fast' ? 'fast' : ZONE_BY_ID[st.zone] ? ZONE_BY_ID[st.zone].name.toLowerCase() : st.zone;
    const what = st.what ? ' '+WHAT[st.what] : '';
    const pace = p ? ' ('+fmtSwimPace(p[0])+'–'+fmtSwimPace(p[1])+'/100 m)' : '';
    const rest = st.reps && st.rest ? ' on '+st.rest+' s rest' : '';
    return (st.reps ? st.reps+' × '+st.m : st.m+' m')+what+(st.zone === 'drill' ? '' : ' '+zn)+pace+rest;
  });
  const body = parts.length ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? ', then ' + parts.slice(1).join(', then ') : '') + '.' : '';
  if (spec.kind === 'test') return spec.blurb + ' Warm up first with 400 m easy and a few 50 m builds.';
  return (spec.blurb ? spec.blurb + ' ' : '') + body;
}
// A session as pages use it: name, kind, mins, metres, tss, text, steps.
export function swimSession(id){
  const s = SWIM_SESSIONS[id];
  if (!s) return null;
  const load = swimLoad(s);
  return Object.assign({}, s, { id, mins: Math.round(load.secs/60), metres: load.metres, tss: load.tss, text: describeSwim(s) });
}
export function plannedSwimTss(id){ const s = swimSession(id); return s ? s.tss : null; }

// "1:45" / "1.45" / "145" -> 105 seconds per 100 m. null if it doesn't look like one.
export function parseSwimPace(str){
  const m = String(str||'').trim().match(/^(\d)[:.](\d{2})$/) || String(str||'').trim().match(/^(\d)(\d{2})$/);
  if (!m) return null;
  const s = Number(m[1])*60 + Number(m[2]);
  return (Number(m[2]) < 60 && s >= 50 && s <= 300) ? s : null;
}
export function fmtSwimPace(sec){
  if (!sec) return '—';
  const s = Math.round(sec);
  return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
}
export function fmtMetres(m){ return m ? (m >= 1000 ? (m/1000).toFixed(m % 1000 ? 2 : 1).replace(/\.?0+$/, '') + ' km' : Math.round(m)+' m') : '—'; }

// CSS from a 400 m and a 200 m time trial (seconds): the pace between them, per 100 m.
export function cssFromTimeTrial(t400, t200){
  if (!(t400 > 0 && t200 > 0) || t400 <= t200) return null;
  const v = (t400 - t200) / 2;
  return v >= 50 && v <= 300 ? Math.round(v) : null;
}

export function swimIf({ durationSec, distanceM, css, feel }){
  if (durationSec > 0 && distanceM > 0 && css > 0){
    const pace = durationSec / (distanceM/100);
    return Math.max(0.4, Math.min(1.15, css / pace));
  }
  return FEEL_IF[feel] || 0.78;
}
export function swimTss(opts){
  if (!(opts.durationSec > 0)) return null;
  return Math.round(opts.durationSec/3600 * Math.pow(swimIf(opts), 3) * 100);
}

export async function saveSwim(supabase, userId, { name, startedAt, durationSec, distanceM, feel, css, water, plan, dayIndex }){
  const record = {
    id: 'swim_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8),
    user_id: userId, sport:'swim', source:'manual', category: water === 'open_water' ? 'open_water' : 'pool',
    workout_name: name || 'Swim', started_at: startedAt, duration_sec: Math.round(durationSec),
    distance_m: distanceM ? Math.round(distanceM) : null,
    tss: swimTss({ durationSec, distanceM, css, feel }),
    intensity_factor: Math.round(swimIf({ durationSec, distanceM, css, feel })*100)/100,
    feel: feel || null, completed: true, samples: [],
    plan_id: plan || null, plan_day_index: dayIndex != null ? dayIndex : null,
  };
  const { error } = await supabase.from('completed_rides').insert(record);
  if (error) throw error;
  return record;
}

export async function loadSwimCss(supabase, userId){
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', SWIM_CSS_KEY).eq('user_id', userId).maybeSingle();
    return data && data.value && Number(data.value.v) || null;
  } catch(_){ return null; }
}

// ---- "Log a swim" sheet (shares the run log's styles) ----

const LOG_CSS = `
.rl-form{ display:grid; gap:12px; margin:6px 0 2px; }
.rl-form label{ display:block; font-size:12px; color:#8B96A5; margin-bottom:5px; text-transform:uppercase; letter-spacing:.05em; }
.rl-form input{ width:100%; box-sizing:border-box; padding:11px 12px; border-radius:9px; border:1px solid #2A323D; background:#11161D; color:#E7ECF2; font:inherit; font-size:15px; margin:0; }
.rl-row{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.rl-feel{ display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; }
.rl-feel button, .rl-seg button{ width:auto; margin:0; padding:9px 2px; border-radius:9px; border:1px solid #2A323D; background:#1D242D; color:#E7ECF2; font:inherit; font-size:12px; font-weight:600; cursor:pointer; }
.rl-feel button.on, .rl-seg button.on{ border-color:#45D6C4; background:rgba(69,214,196,.14); }
.rl-seg{ display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.rl-sum{ font-size:13px; color:#B4BDC9; font-family:'JetBrains Mono',ui-monospace,monospace; min-height:18px; }
.rl-sum b{ color:#E7ECF2; }
.rl-note{ font-size:13px; color:#B4BDC9; line-height:1.45; margin:0; background:#11161D; border:1px solid #2A323D; border-radius:9px; padding:10px 12px; }
`;
function localIso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// session: optional { dayIndex, date, workoutId } of a planned swim, with planId. Resolves with the saved record, or null.
export async function openSwimLog(supabase, userId, { session = null, planId = null } = {}){
  if (!document.getElementById('sl-style')){ const st = document.createElement('style'); st.id = 'sl-style'; st.textContent = LOG_CSS; document.head.appendChild(st); }
  const css = await loadSwimCss(supabase, userId);
  setSwimCss(css);
  const planned = session ? swimSession(session.workoutId) : null;
  const today = localIso(new Date());
  const date = session && session.date <= today ? session.date : today;
  const form = document.createElement('div');
  form.className = 'rl-form';
  form.innerHTML = (planned ? '<p class="rl-note">'+planned.text+'</p>' : '')
    + '<div><label for="slName">Name</label><input id="slName" value="'+(planned ? planned.name : 'Swim')+'"></div>'
    + '<div><label>Where</label><div class="rl-seg"><button type="button" data-w="pool" class="on">Pool</button><button type="button" data-w="open_water">Open water</button></div></div>'
    + '<div class="rl-row"><div><label for="slDate">Date</label><input id="slDate" type="date" max="'+today+'" value="'+date+'"></div>'
    + '<div><label for="slTime">Time (min or h:mm:ss)</label><input id="slTime" inputmode="numeric" placeholder="'+(planned ? planned.mins : 40)+'"'+(planned ? ' value="'+planned.mins+'"' : '')+'></div></div>'
    + '<div><label for="slDist">Distance (metres)</label><input id="slDist" inputmode="numeric" placeholder="e.g. 1500"'+(planned ? ' value="'+planned.metres+'"' : '')+'></div>'
    + '<div><label>How did it feel?</label><div class="rl-feel">'+['Easy','Moderate','Hard','Very hard','All out'].map((l,i)=>'<button type="button" data-v="'+(i+1)+'">'+l+'</button>').join('')+'</div></div>'
    + '<div class="rl-sum" id="slSum"></div>';
  let feel = null, water = 'pool';
  const val = id => form.querySelector('#'+id).value;
  function read(){
    const durationSec = parseDuration(val('slTime'));
    const m = parseFloat(String(val('slDist')).replace(',', '.'));
    return { durationSec, distanceM: m > 0 ? (m < 20 ? m*1000 : m) : null }; // "1.5" means km
  }
  function summary(){
    const { durationSec, distanceM } = read();
    const el = form.querySelector('#slSum');
    if (!durationSec){ el.textContent = ''; return; }
    const tss = swimTss({ durationSec, distanceM, css, feel });
    el.innerHTML = (distanceM ? '<b>'+fmtSwimPace(durationSec/(distanceM/100))+'</b> /100 m · ' : '') + '<b>'+tss+'</b> TSS'
      + (!css && distanceM ? ' · set your CSS in Settings for pace-based TSS' : '');
  }
  form.addEventListener('input', summary);
  form.querySelector('.rl-feel').addEventListener('click', e=>{
    const b = e.target.closest('[data-v]'); if (!b) return;
    feel = Number(b.dataset.v);
    form.querySelectorAll('.rl-feel button').forEach(x=> x.classList.toggle('on', x === b));
    summary();
  });
  form.querySelector('.rl-seg').addEventListener('click', e=>{
    const b = e.target.closest('[data-w]'); if (!b) return;
    water = b.dataset.w;
    form.querySelectorAll('.rl-seg button').forEach(x=> x.classList.toggle('on', x === b));
  });
  summary();
  let saved = null;
  await showSheet({ title: planned ? 'Log '+planned.name.toLowerCase() : 'Log a swim', content: form,
    buttons:[{ label:'Save swim', value:'save', kind:'primary' }, { label:'Cancel', value:null }],
    onAction: async ()=>{
      const { durationSec, distanceM } = read();
      if (!durationSec){ form.querySelector('#slTime').focus(); form.querySelector('#slSum').textContent = 'Enter how long you swam for.'; return false; }
      const d = val('slDate') || today;
      const startedAt = d === today ? new Date(Date.now() - durationSec*1000).toISOString() : new Date(d+'T12:00:00').toISOString();
      try {
        saved = await saveSwim(supabase, userId, { name: val('slName').trim() || 'Swim', startedAt, durationSec, distanceM, feel, css, water,
          plan: session ? planId : null, dayIndex: session ? session.dayIndex : null });
      } catch(e){
        await notify('Check your connection and try again.', 'Couldn\'t save that swim');
        return false;
      }
    } });
  return saved;
}
