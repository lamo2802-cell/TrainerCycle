// Calendar diary: notes, and single workouts planned on a date outside any plan. Stored as one list
// in settings key calendar_items (like holidays):
//   { id, date:'YYYY-MM-DD', kind:'note', text }
//   { id, date, kind:'planned', day:{ type:'workout', workoutType:'cycling'|'run'|'swim'|'strength', workoutId, session? } }
// Run and swim specs live inline on day.session, as in plan-builder plans, under workoutId 'cal-'+id.
// A planned workout counts as done when an activity of the same sport on that date isn't part of a plan.
import { showSheet, notify, ask } from './sheet.js?v=2';
import { registerRunSession, openRunLog, parseDuration } from './run.js?v=5';
import { registerSwimSession, openSwimLog } from './swim.js?v=2';
import { sessionInfo, RUN_TYPES, SWIM_TYPES, makeRun, makeSwim, runTypeOf, runMinsOf, swimTypeOf, swimMetresOf, durationOf } from './plan-kit.js?v=2';

export const DIARY_KEY = 'calendar_items';
const MAX_ITEMS = 500;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtH = secs => { const m = Math.round(secs/60); return m >= 60 ? Math.floor(m/60)+'h'+(m%60 ? String(m%60).padStart(2,'0') : '') : m+' min'; };
function localIso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const todayIso = () => localIso(new Date());
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function longDate(iso){ const [y, m, d] = iso.split('-').map(Number); return new Date(y, m-1, d).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' }); }

export async function loadDiary(supabase, userId){
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', DIARY_KEY).eq('user_id', userId).maybeSingle();
    const list = data && data.value && Array.isArray(data.value.v) ? data.value.v : [];
    registerDiary(list);
    return list;
  } catch(_){ return []; }
}
export async function saveDiary(supabase, userId, list){
  const keep = list.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).slice(-MAX_ITEMS);
  const { error } = await supabase.from('settings').upsert({ user_id:userId, key:DIARY_KEY, value:{ v:keep }, updated_at:new Date().toISOString() }, { onConflict:'user_id,key' });
  if (error) throw error;
  registerDiary(keep);
  return keep;
}
// Make planned runs and swims known to run.js and swim.js. Safe to call more than once.
export function registerDiary(list){
  (list || []).forEach(it => {
    const d = it.kind === 'planned' && it.day;
    if (!d || !d.session) return;
    if (d.workoutType === 'run') registerRunSession(d.workoutId, d.session);
    else if (d.workoutType === 'swim') registerSwimSession(d.workoutId, d.session);
  });
}

export const notesOn = (date, list) => (list || []).filter(it => it.kind === 'note' && it.date === date);
const SPORT_OF = { cycling:'ride', run:'run', swim:'swim' };

// Planned items as session objects the pages can show next to plan sessions. rides: completed_rides rows
// with started_at, sport and plan_id; each ride ticks off at most one planned item.
export function diarySessions(list, workouts, ftp, rides){
  const free = (rides || []).filter(r => !r.plan_id).map(r => ({ r, date: localIso(new Date(r.started_at)), sport: r.sport || 'ride' }));
  return (list || []).filter(it => it.kind === 'planned' && it.day).sort((a, b) => a.date < b.date ? -1 : 1).map(it => {
    const d = it.day, t = d.workoutType || 'cycling';
    const info = sessionInfo(d, workouts, ftp) || { name:'Workout' };
    const i = free.findIndex(x => x.date === it.date && x.sport === SPORT_OF[t]);
    const doneRide = i >= 0 ? free.splice(i, 1)[0].r : null;
    return { diaryId: it.id, date: it.date, plannedDate: it.date, dayObj: d, name: info.name, category: t === 'strength' ? 'strength' : t === 'run' ? 'run' : t === 'swim' ? 'swim' : info.category,
      isStrength: t === 'strength', isRun: t === 'run', isSwim: t === 'swim', isBrick:false, isRace:false, run: info.run || null, info, steps: info.steps,
      durationSec: info.durationSec || null, tss: info.tss || null, done: !!doneRide, doneRide, skipped:false };
  });
}
// Where a planned item's main button goes: Live Ride or TrainerStrength (runs and swims are logged instead).
export function diaryHref(s){
  return s.isStrength ? 'trainerstrength.html?load='+encodeURIComponent(s.dayObj.workoutId) : 'live.html?load='+encodeURIComponent(s.dayObj.workoutId);
}

// ---- sheets ----

const CSS = `
.dy-form{ display:grid; gap:12px; margin:6px 0 2px; }
.dy-form label{ display:block; font-size:12px; color:#8B96A5; margin-bottom:5px; text-transform:uppercase; letter-spacing:.05em; }
.dy-form input, .dy-form select, .dy-form textarea{ width:100%; box-sizing:border-box; padding:10px 12px; border-radius:9px; border:1px solid #2A323D; background:#11161D; color:#E7ECF2; font:inherit; font-size:14.5px; margin:0; color-scheme:dark; }
.dy-form textarea{ min-height:110px; resize:vertical; line-height:1.45; }
.dy-two{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.dy-seg{ display:grid; grid-auto-flow:column; grid-auto-columns:minmax(0,1fr); gap:6px; }
.dy-seg button, .dy-feel button{ width:auto; margin:0; padding:9px 2px; border-radius:9px; border:1px solid #2A323D; background:#1D242D; color:#E7ECF2; font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; }
.dy-seg button.on, .dy-feel button.on{ border-color:#45D6C4; background:rgba(69,214,196,.14); }
.dy-feel{ display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; }
.dy-prev{ font-size:12.5px; color:#B4BDC9; line-height:1.5; background:#11161D; border:1px solid #2A323D; border-radius:9px; padding:10px 12px; min-height:20px; }
.dy-prev b{ color:#E7ECF2; }
.dy-sum{ font-size:13px; color:#B4BDC9; font-family:'JetBrains Mono',ui-monospace,monospace; min-height:18px; }
.dy-sum b{ color:#E7ECF2; }
.dy-pick{ display:grid; gap:8px; }
.dy-pick button{ display:flex; gap:12px; align-items:center; text-align:left; width:100%; margin:0; padding:12px 14px; border-radius:10px; border:1px solid #2A323D; background:#1D242D; color:#E7ECF2; font:inherit; cursor:pointer; }
.dy-pick button:hover{ border-color:#45D6C4; }
.dy-pick b{ display:block; font-size:14px; } .dy-pick small{ display:block; font-size:12.5px; color:#8B96A5; margin-top:2px; }
.dy-pick i{ width:10px; height:10px; border-radius:50%; flex-shrink:0; }
`;
function styleOnce(){ if (!document.getElementById('dy-style')){ const st = document.createElement('style'); st.id = 'dy-style'; st.textContent = CSS; document.head.appendChild(st); } }

// What to add on a day. Logging is for today and earlier, planning for today and later.
// Resolves with { list } after a change, { saved } after logging an activity, or null.
export async function openDayAdd(supabase, userId, { date, list, workouts, ftp }){
  styleOnce();
  const today = todayIso();
  const opts = [
    { v:'note', c:'#E8B93D', b:'Add a note', s:'How you felt, kit changes, anything worth remembering' },
    date <= today && { v:'log', c:'#45D6C4', b:'Log an activity', s:'A ride, run or swim you did'+(date === today ? ' today' : ' on this day') },
    date >= today && { v:'plan', c:'#4C8BF5', b:'Plan a workout', s:'A ride, run, swim or strength session for this day' },
  ].filter(Boolean);
  const box = document.createElement('div');
  box.className = 'dy-pick';
  box.innerHTML = opts.map(o => '<button type="button" data-v="'+o.v+'"><i style="background:'+o.c+'"></i><span><b>'+o.b+'</b><small>'+o.s+'</small></span></button>').join('');
  const pick = await pickFrom(box, longDate(date));
  if (pick === 'note') return openNoteSheet(supabase, userId, { date, list });
  if (pick === 'plan') return openPlanSheet(supabase, userId, { date, list, workouts, ftp });
  if (pick === 'log'){ const saved = await openActivityLog(supabase, userId, { date, ftp }); return saved ? { saved } : null; }
  return null;
}

export async function openNoteSheet(supabase, userId, { date, list, existing = null }){
  styleOnce();
  const box = document.createElement('div');
  box.className = 'dy-form';
  box.innerHTML = '<div><label for="dyNote">Note</label><textarea id="dyNote" maxlength="1000" placeholder="e.g. Legs heavy after a long day at work">'+esc(existing ? existing.text : '')+'</textarea></div>';
  setTimeout(() => { const t = box.querySelector('textarea'); if (t) t.focus(); }, 50);
  let out = null;
  await showSheet({ title: (existing ? 'Note · ' : 'Add a note · ')+longDate(date), content: box,
    buttons: [{ label:'Save note', value:'save', kind:'primary' }].concat(existing ? [{ label:'Delete', value:'del', kind:'danger' }] : [], [{ label:'Cancel', value:null }]),
    onAction: async v => {
      if (!v) return;
      const text = box.querySelector('textarea').value.trim();
      let next;
      if (v === 'del' || !text) next = list.filter(it => !existing || it.id !== existing.id);
      else if (existing) next = list.map(it => it.id === existing.id ? Object.assign({}, it, { text }) : it);
      else next = list.concat({ id: newId(), date, kind:'note', text });
      if (!existing && !text) return;
      try { out = { list: await saveDiary(supabase, userId, next) }; }
      catch(_){ await notify('Check your connection and try again.', 'Couldn\'t save that note'); return false; }
    } });
  return out;
}

const CAT_LABEL = { recovery:'Recovery', endurance:'Endurance', tempo:'Tempo', sweet_spot:'Sweet spot', threshold:'Threshold', over_under:'Over/under', vo2max:'VO2 max', anaerobic:'Anaerobic', test:'FTP test' };
const PLAN_SPORTS = [{ id:'cycling', label:'Ride' }, { id:'run', label:'Run' }, { id:'swim', label:'Swim' }, { id:'strength', label:'Strength' }];

// Plan a single workout on a date, or change or delete one. With existing on today or earlier, it also
// offers the session itself; that resolves with { go:true } for the page to start or log it.
export async function openPlanSheet(supabase, userId, { date, list, workouts, ftp, existing = null }){
  styleOnce();
  const today = todayIso();
  const lib = Object.entries(workouts).filter(([, w]) => w.steps).map(([id, w]) => Object.assign({ id }, w));
  const strength = Object.entries(workouts).filter(([, w]) => w.category === 'strength' && !w.steps).map(([id, w]) => ({ id, name: w.name }));
  const d0 = existing ? existing.day : null;
  let sport = d0 ? (d0.workoutType || 'cycling') : 'cycling';
  const runSpec = d0 && sport === 'run' ? d0.session : null, swimSpec = d0 && sport === 'swim' ? d0.session : null;
  const byCat = {};
  lib.forEach(w => { (byCat[w.category] = byCat[w.category] || []).push(w); });
  const selRide = d0 && sport === 'cycling' ? d0.workoutId : (lib.find(w => w.id === 'prebuilt-endurance-60') || lib[0] || {}).id;
  const rideOpts = Object.keys(CAT_LABEL).filter(c => byCat[c]).map(c => '<optgroup label="'+CAT_LABEL[c]+'">'
    + byCat[c].sort((a, b) => durationOf(a) - durationOf(b)).map(w => '<option value="'+esc(w.id)+'"'+(w.id === selRide ? ' selected' : '')+'>'+esc(w.name)+' · '+Math.round(durationOf(w)/60)+' min</option>').join('')+'</optgroup>').join('');
  const box = document.createElement('div');
  box.className = 'dy-form';
  box.innerHTML = '<div class="dy-seg" id="dySport">'+PLAN_SPORTS.map(s => '<button type="button" data-s="'+s.id+'">'+s.label+'</button>').join('')+'</div>'
    + '<div data-for="cycling"><label for="dyRide">Workout</label><select id="dyRide">'+rideOpts+'</select></div>'
    + '<div data-for="run" class="dy-two"><div><label for="dyRunType">Run</label><select id="dyRunType">'+RUN_TYPES.filter(t => t.id !== 'brick').map(t => '<option value="'+t.id+'"'+(runSpec && runTypeOf(runSpec) === t.id ? ' selected' : '')+'>'+t.label+'</option>').join('')+'</select></div>'
      + '<div><label for="dyRunMins">Minutes</label><input id="dyRunMins" type="number" min="10" max="240" step="5" value="'+(runSpec ? runMinsOf(runSpec) : 40)+'"></div></div>'
    + '<div data-for="swim" class="dy-two"><div><label for="dySwimType">Swim</label><select id="dySwimType">'+SWIM_TYPES.map(t => '<option value="'+t.id+'"'+(swimSpec && swimTypeOf(swimSpec) === t.id ? ' selected' : '')+'>'+t.label+'</option>').join('')+'</select></div>'
      + '<div><label for="dySwimM">Metres</label><input id="dySwimM" type="number" min="400" max="6000" step="100" value="'+(swimSpec ? swimMetresOf(swimSpec) : 1500)+'"></div></div>'
    + '<div data-for="strength"><label for="dyStr">Session</label>'+(strength.length ? '<select id="dyStr">'+strength.map(w => '<option value="'+esc(w.id)+'"'+(d0 && sport === 'strength' && d0.workoutId === w.id ? ' selected' : '')+'>'+esc(w.name)+'</option>').join('')+'</select>' : '<div class="dy-prev">No strength sessions yet. Make one in TrainerStrength.</div>')+'</div>'
    + '<div><label for="dyDate">Date</label><input id="dyDate" type="date" min="'+today+'" value="'+(date >= today ? date : today)+'"></div>'
    + '<div class="dy-prev" id="dyPrev"></div>';
  const q = id => box.querySelector('#'+id);
  const wid = existing ? 'cal-'+existing.id : 'cal-preview';
  function current(){
    if (sport === 'cycling') return { type:'workout', workoutType:'cycling', workoutId: q('dyRide').value };
    if (sport === 'strength') return strength.length ? { type:'workout', workoutType:'strength', workoutId: q('dyStr').value } : null;
    if (sport === 'run') return { type:'workout', workoutType:'run', workoutId: wid, session: makeRun(q('dyRunType').value, Number(q('dyRunMins').value) || 40) };
    return { type:'workout', workoutType:'swim', workoutId: wid, session: makeSwim(q('dySwimType').value, Number(q('dySwimM').value) || 1500) };
  }
  function paint(){
    box.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === sport));
    box.querySelectorAll('[data-for]').forEach(el => { el.style.display = el.dataset.for === sport ? '' : 'none'; });
    const c = current();
    if (c) registerDiary([{ kind:'planned', day:c }]);
    const s = c && sessionInfo(c, workouts, ftp);
    q('dyPrev').innerHTML = !s ? 'Pick a session.' : '<b>'+esc(s.name)+'</b>'+(s.durationSec ? ' · '+fmtH(s.durationSec) : '')+(s.tss ? ' · '+s.tss+' TSS' : '')
      + (s.kind === 'run' || s.kind === 'swim' ? '<br>'+esc(s.text || '') : '');
  }
  box.addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b){ sport = b.dataset.s; paint(); } });
  box.addEventListener('input', paint);
  box.addEventListener('change', paint);
  paint();
  const goLabel = { cycling:'Ride now', strength:'Start session', run:'Log run', swim:'Log swim' };
  const canGo = existing && existing.date <= today;
  let out = null;
  await showSheet({ title: existing ? 'Planned · '+longDate(existing.date) : 'Plan a workout', content: box,
    buttons: (canGo ? [{ label: goLabel[sport] || 'Start', value:'go', kind:'primary' }, { label:'Save', value:'save' }] : [{ label: existing ? 'Save changes' : 'Add to calendar', value:'save', kind:'primary' }])
      .concat(existing ? [{ label:'Delete', value:'del', kind:'danger' }] : [], [{ label:'Cancel', value:null }]),
    onAction: async v => {
      if (!v) return;
      if (v === 'go'){ out = { go:true, list }; return; }
      if (v === 'del'){
        if (!(await ask('It comes off your calendar and Today.', { title:'Delete this workout?', ok:'Delete', danger:true }))) return false;
        try { out = { list: await saveDiary(supabase, userId, list.filter(it => it.id !== existing.id)) }; }
        catch(_){ await notify('Check your connection and try again.', 'Couldn\'t delete that'); return false; }
        return;
      }
      const day = current();
      if (!day){ return false; }
      const on = q('dyDate').value || date;
      if (on < today){ q('dyPrev').textContent = 'Pick today or a later day. To add something you\'ve already done, log it as an activity.'; return false; }
      const id = existing ? existing.id : newId();
      if (day.session) day.workoutId = 'cal-'+id;
      const item = { id, date: on, kind:'planned', day };
      const next = existing ? list.map(it => it.id === id ? item : it) : list.concat(item);
      try { out = { list: await saveDiary(supabase, userId, next) }; }
      catch(_){ await notify('Check your connection and try again.', 'Couldn\'t save that workout'); return false; }
    } });
  return out;
}

// ---- logging an activity by hand ----

const RIDE_FEEL_IF = { 1:0.6, 2:0.7, 3:0.8, 4:0.88, 5:0.95 };
export function rideIf({ avgPower, ftp, feel }){
  if (avgPower > 0 && ftp > 0) return Math.max(0.3, Math.min(1.3, avgPower / ftp));
  return RIDE_FEEL_IF[feel] || 0.7;
}
export function rideTss(opts){ return opts.durationSec > 0 ? Math.round(opts.durationSec/3600 * Math.pow(rideIf(opts), 2) * 100) : null; }

export async function saveManualRide(supabase, userId, { name, startedAt, durationSec, distanceM, avgPower, ftp, feel, where }){
  const IF = rideIf({ avgPower, ftp, feel });
  const record = {
    id: 'ride_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8),
    user_id: userId, sport:'ride', source:'manual', category: where === 'indoor' ? 'indoor' : 'outdoor',
    workout_name: name || 'Ride', started_at: startedAt, duration_sec: Math.round(durationSec),
    distance_m: distanceM ? Math.round(distanceM) : null, avg_power: avgPower > 0 ? Math.round(avgPower) : null,
    tss: rideTss({ durationSec, avgPower, ftp, feel }), intensity_factor: Math.round(IF*100)/100,
    feel: feel || null, completed: true, samples: [],
  };
  const { error } = await supabase.from('completed_rides').insert(record);
  if (error) throw error;
  return record;
}

export async function openRideLog(supabase, userId, { date = null, ftp = null } = {}){
  styleOnce();
  if (ftp == null){
    try { const { data } = await supabase.from('settings').select('value').eq('key', 'ftp').eq('user_id', userId).maybeSingle(); ftp = data && data.value && Number(data.value.v) || null; } catch(_){}
  }
  const today = todayIso();
  const on = date && date <= today ? date : today;
  const box = document.createElement('div');
  box.className = 'dy-form';
  box.innerHTML = '<div><label for="dyName">Name</label><input id="dyName" value="Ride"></div>'
    + '<div><label>Where</label><div class="dy-seg" id="dyWhere"><button type="button" data-w="outdoor" class="on">Outside</button><button type="button" data-w="indoor">Indoors</button></div></div>'
    + '<div class="dy-two"><div><label for="dyDate">Date</label><input id="dyDate" type="date" max="'+today+'" value="'+on+'"></div>'
    + '<div><label for="dyTime">Time (min or h:mm)</label><input id="dyTime" inputmode="numeric" placeholder="1:30"></div></div>'
    + '<div class="dy-two"><div><label for="dyDist">Distance (km, optional)</label><input id="dyDist" inputmode="decimal" placeholder="e.g. 42"></div>'
    + '<div><label for="dyPow">Average power (W, optional)</label><input id="dyPow" inputmode="numeric" placeholder="e.g. 180"></div></div>'
    + '<div><label>How did it feel?</label><div class="dy-feel">'+['Easy','Moderate','Hard','Very hard','All out'].map((l,i)=>'<button type="button" data-v="'+(i+1)+'">'+l+'</button>').join('')+'</div></div>'
    + '<div class="dy-sum" id="dySum"></div>';
  let feel = null, where = 'outdoor';
  const val = id => box.querySelector('#'+id).value;
  function read(){
    const km = parseFloat(String(val('dyDist')).replace(',', '.'));
    // Rides are long, so "2:10" means 2 h 10 min here (h:mm:ss still works).
    const t = String(val('dyTime')).trim(), hm = /^\d+:\d{1,2}$/.test(t);
    return { durationSec: parseDuration(hm ? t+':00' : t), distanceM: km > 0 ? km*1000 : null, avgPower: Number(val('dyPow')) || null };
  }
  function summary(){
    const r = read(), el = box.querySelector('#dySum');
    if (!r.durationSec){ el.textContent = ''; return; }
    el.innerHTML = (r.distanceM ? '<b>'+(r.distanceM/1000/(r.durationSec/3600)).toFixed(1)+'</b> km/h · ' : '')+'<b>'+rideTss(Object.assign({ ftp, feel }, r))+'</b> TSS'
      + (r.avgPower && !ftp ? ' · set your FTP in Settings for power-based TSS' : '');
  }
  box.addEventListener('input', summary);
  box.querySelector('.dy-feel').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    feel = Number(b.dataset.v);
    box.querySelectorAll('.dy-feel button').forEach(x => x.classList.toggle('on', x === b));
    summary();
  });
  box.querySelector('#dyWhere').addEventListener('click', e => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    where = b.dataset.w;
    box.querySelectorAll('#dyWhere button').forEach(x => x.classList.toggle('on', x === b));
  });
  let saved = null;
  await showSheet({ title:'Log a ride', content: box,
    buttons:[{ label:'Save ride', value:'save', kind:'primary' }, { label:'Cancel', value:null }],
    onAction: async v => {
      if (!v) return;
      const r = read();
      if (!r.durationSec){ box.querySelector('#dyTime').focus(); box.querySelector('#dySum').textContent = 'Enter how long you rode for.'; return false; }
      const d = val('dyDate') || today;
      if (d > today){ box.querySelector('#dySum').textContent = 'You can only log rides on today or earlier.'; return false; }
      const startedAt = d === today ? new Date(Date.now() - r.durationSec*1000).toISOString() : new Date(d+'T12:00:00').toISOString();
      try { saved = await saveManualRide(supabase, userId, Object.assign({ name: val('dyName').trim() || 'Ride', startedAt, ftp, feel, where }, r)); }
      catch(_){ await notify('Check your connection and try again.', 'Couldn\'t save that ride'); return false; }
    } });
  return saved;
}

// Pick the sport, then the matching log sheet. Resolves with the saved activity, or null.
export async function openActivityLog(supabase, userId, { date = null, ftp = null } = {}){
  styleOnce();
  const box = document.createElement('div');
  box.className = 'dy-pick';
  box.innerHTML = [['ride', '#4C8BF5', 'Ride', 'Outside or indoors, recorded somewhere else'], ['run', '#C084FC', 'Run', 'Time, distance and how it felt'], ['swim', '#38BDF8', 'Swim', 'Pool or open water']]
    .map(([v, c, b, s]) => '<button type="button" data-v="'+v+'"><i style="background:'+c+'"></i><span><b>'+b+'</b><small>'+s+'</small></span></button>').join('');
  const v = await pickFrom(box, 'Log an activity'+(date ? ' · '+longDate(date) : ''));
  if (v === 'ride') return openRideLog(supabase, userId, { date, ftp });
  if (v === 'run') return openRunLog(supabase, userId, { date });
  if (v === 'swim') return openSwimLog(supabase, userId, { date });
  return null;
}

// A sheet of big choice buttons: resolves with the picked data-v, or null.
function pickFrom(box, title){
  return new Promise(resolve => {
    let pick = null;
    showSheet({ title, content: box, buttons:[{ label:'Cancel', value:null }] }).then(() => resolve(pick));
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      pick = b.dataset.v;
      const cancel = box.closest('.tc-sheet').querySelector('.tc-sheet-btns button:last-child');
      if (cancel) cancel.click();
    });
  });
}
