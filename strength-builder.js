// Build your own strength session: a sheet on TrainerStrength that saves a row to strength_workouts
// (user_id = the rider, source 'custom'). The row has the same shape as library sessions, so plans,
// the calendar, Today and progression all work with it. An exercise with superset:true is done in
// rounds with the one above it (A1, B1, rest, A2, B2, ...).
import { showSheet, ask } from './sheet.js?v=2';

// Moves to pick from, by base key. The rider's own version (goblet squat, barbell squat...) is used in the session.
export const MOVES = [
  ['squat','Squat'], ['deadlift','Deadlift / hinge'], ['lunge','Lunge / split squat'], ['glute_bridge','Glute bridge / hip thrust'],
  ['calf_raise','Calf raise'], ['pushup','Push-up / bench press'], ['shoulder_press','Shoulder press'], ['row','Row'],
  ['bicep_curl','Curl'], ['plank','Plank (hold)'], ['situp','Sit-up'], ['mountain_climber','Mountain climber'],
  ['clamshell','Clamshell'], ['standing_hip_abduction','Standing hip abduction'], ['straight_leg_raise','Straight leg raise'],
];
const NAME = Object.fromEntries(MOVES);
const SHORT = { plank:'Plank', squat:'Squat', deadlift:'Deadlift', lunge:'Lunge', glute_bridge:'Glute bridge', pushup:'Push-up', bicep_curl:'Curl' };
const RESTS = [30, 45, 60, 75, 90, 120, 150, 180];
const isHold = key => key === 'plank';
const holdOf = notes => { const m = /(\d+)\s*sec/i.exec(notes || ''); return m ? Number(m[1]) : 30; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const CSS = `
.sb-name, .sb-row input[type=number]{ background:#11161C; color:#E7ECF2; border:1px solid #2A323D; border-radius:8px; font:inherit; box-sizing:border-box; }
.sb-name{ width:100%; margin:0 0 12px; padding:10px 12px; font-size:15px; }
.sb-name:focus, .sb-row input[type=number]:focus{ outline:2px solid #45D6C4; outline-offset:1px; }
.sb-list{ display:flex; flex-direction:column; gap:8px; }
.sb-ex{ border:1px solid #2A323D; border-radius:10px; padding:10px; background:#1D242D; }
.sb-ex.paired{ margin-top:-4px; border-top-left-radius:0; border-top-right-radius:0; border-left:3px solid #45D6C4; }
.sb-top{ display:flex; gap:6px; align-items:center; }
.sb-top .sb-tag{ font:600 12px var(--mono, monospace); color:#45D6C4; min-width:22px; }
.sb-top select{ flex:1; min-width:0; margin:0; }
.sb-top button{ width:32px; height:32px; padding:0; margin:0; flex-shrink:0; font-size:15px; }
.sb-row{ display:flex; flex-wrap:wrap; gap:8px 12px; margin-top:8px; align-items:center; font-size:12.5px; color:#B4BDC9; }
.sb-row label{ display:flex; align-items:center; gap:5px; }
.sb-row input[type=number]{ width:54px; margin:0; padding:6px; }
.sb-row select{ width:auto; margin:0; padding:6px 8px; }
.sb-row input[type=checkbox]{ width:auto; margin:0; }
.sb-add{ width:100%; margin:10px 0 0; }
.sb-err{ color:#FF8A8D; font-size:13px; min-height:18px; margin-top:8px; }
`;
function ensureStyle(){
  if (document.getElementById('sb-style')) return;
  const s = document.createElement('style'); s.id = 'sb-style'; s.textContent = CSS; document.head.appendChild(s);
}

// Exercise rows as edited: { key, sets, lo, hi, hold, rest, superset, notes }
function fromWorkout(w){
  return (w.exercises || []).map(e => ({ key:e.key, sets:e.sets || 3, lo:Number(e.reps) || 8, hi:Number(e.repsMax) || (Number(e.reps) >= 8 ? Number(e.reps) + 4 : Number(e.reps) + 2),
    hold: holdOf(e.notes), rest:e.restSeconds || 60, superset:!!e.superset, notes:e.notes || '', variant:e.variant }));
}
function toExercises(rows){
  return rows.map((r, i) => {
    const ex = { key:r.key, name: SHORT[r.key] || NAME[r.key] || r.key, sets:r.sets, restSeconds:r.rest };
    if (isHold(r.key)){ ex.reps = 1; ex.notes = 'Hold '+r.hold+' seconds'; }
    else { ex.reps = r.lo; ex.repsMax = r.hi; if (r.notes && !/^Hold \d+ seconds$/.test(r.notes)) ex.notes = r.notes; }
    if (r.variant) ex.variant = r.variant;
    if (r.superset && i > 0) ex.superset = true;
    return ex;
  });
}

// workout: an existing row to edit (own) or copy (library); null for a new one.
// Returns { saved: row } | { deleted: id } | null.
export async function openBuilder({ supabase, user, workout = null, copy = false }){
  ensureStyle();
  const own = !!(workout && !copy && workout.user_id === user.id);
  let rows = workout ? fromWorkout(workout) : [
    { key:'squat', sets:3, lo:8, hi:12, hold:30, rest:90, superset:false },
    { key:'row', sets:3, lo:8, hi:12, hold:30, rest:90, superset:false },
    { key:'plank', sets:2, lo:1, hi:1, hold:40, rest:45, superset:false },
  ];
  const box = document.createElement('div');
  box.innerHTML = '<input class="sb-name" id="sbName" maxlength="60" placeholder="Session name" aria-label="Session name" value="'+esc(workout ? (copy ? workout.name+' (my version)' : workout.name) : '')+'">'
    + '<div class="sb-list" id="sbList"></div><button type="button" class="sb-add" id="sbAdd">+ Add exercise</button><div class="sb-err" id="sbErr" role="status"></div>';
  const list = box.querySelector('#sbList');
  function tags(){
    // 1, 2a, 2b, 3 ... a superset shares its number with the exercise above
    const out = []; let n = 0, letter = 0;
    rows.forEach((r, i) => {
      if (r.superset && i > 0){ if (!letter){ out[i-1] = n + 'a'; letter = 1; } letter++; out.push(n + String.fromCharCode(96 + letter)); }
      else { n++; letter = 0; out.push(String(n)); }
    });
    return out;
  }
  function draw(){
    const t = tags();
    list.innerHTML = rows.map((r, i) => '<div class="sb-ex'+(r.superset && i > 0 ? ' paired' : '')+'" data-i="'+i+'">'
      + '<div class="sb-top"><span class="sb-tag">'+t[i]+'</span><select data-f="key" aria-label="Exercise">'+MOVES.map(([k, n]) => '<option value="'+k+'"'+(k === r.key ? ' selected' : '')+'>'+n+'</option>').join('')+'</select>'
      + '<button type="button" data-mv="-1" aria-label="Move up"'+(i === 0 ? ' disabled' : '')+'>↑</button><button type="button" data-mv="1" aria-label="Move down"'+(i === rows.length-1 ? ' disabled' : '')+'>↓</button><button type="button" data-del aria-label="Remove">✕</button></div>'
      + '<div class="sb-row"><label>Sets <input type="number" data-f="sets" min="1" max="8" value="'+r.sets+'"></label>'
      + (isHold(r.key) ? '<label>Hold <input type="number" data-f="hold" min="5" max="300" step="5" value="'+r.hold+'"> s</label>'
        : '<label>Reps <input type="number" data-f="lo" min="1" max="50" value="'+r.lo+'"> to <input type="number" data-f="hi" min="1" max="60" value="'+r.hi+'"></label>')
      + '<label>Rest <select data-f="rest">'+RESTS.map(s => '<option value="'+s+'"'+(s === r.rest ? ' selected' : '')+'>'+(s < 120 ? s+' s' : (s/60)+' min')+'</option>').join('')+'</select></label>'
      + (i > 0 ? '<label><input type="checkbox" data-f="superset"'+(r.superset ? ' checked' : '')+'> Superset with the one above</label>' : '')
      + '</div></div>').join('');
  }
  draw();
  list.addEventListener('change', e => {
    const row = e.target.closest('[data-i]'), f = e.target.dataset.f; if (!row || !f) return;
    const r = rows[Number(row.dataset.i)];
    if (f === 'key'){ r.key = e.target.value; r.variant = null; draw(); return; }
    if (f === 'superset'){ r.superset = e.target.checked; draw(); return; }
    r[f] = Number(e.target.value) || 0;
  });
  list.addEventListener('click', e => {
    const row = e.target.closest('[data-i]'); if (!row) return;
    const i = Number(row.dataset.i);
    if (e.target.closest('[data-del]')){ rows.splice(i, 1); if (rows[0]) rows[0].superset = false; draw(); }
    const mv = e.target.closest('[data-mv]');
    if (mv){ const j = i + Number(mv.dataset.mv); if (j < 0 || j >= rows.length) return; [rows[i], rows[j]] = [rows[j], rows[i]]; rows[0].superset = false; draw(); }
  });
  box.querySelector('#sbAdd').addEventListener('click', () => { rows.push({ key:'pushup', sets:3, lo:8, hi:12, hold:30, rest:60, superset:false }); draw(); list.lastElementChild.scrollIntoView({ block:'nearest' }); });

  let saved = null;
  const err = box.querySelector('#sbErr');
  async function save(){
    const name = box.querySelector('#sbName').value.trim();
    if (!name){ err.textContent = 'Give the session a name.'; return false; }
    if (!rows.length){ err.textContent = 'Add at least one exercise.'; return false; }
    const bad = rows.find(r => !(r.sets >= 1) || (isHold(r.key) ? !(r.hold >= 5) : !(r.lo >= 1 && r.hi >= r.lo)));
    if (bad){ err.textContent = 'Check '+NAME[bad.key]+': sets and reps need numbers, and the top of the range can\'t be below the bottom.'; return false; }
    const row = { name, exercises: toExercises(rows) };
    err.textContent = 'Saving…';
    const res = own
      ? await supabase.from('strength_workouts').update(row).eq('id', workout.id).eq('user_id', user.id).select().maybeSingle()
      : await supabase.from('strength_workouts').insert(Object.assign({ id:'my-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), user_id:user.id, source:'custom' }, row)).select().maybeSingle();
    if (res.error || !res.data){ err.textContent = 'Couldn\'t save. Check your connection and try again.'; return false; }
    saved = res.data;
    return true;
  }
  const buttons = [{ label: own ? 'Save changes' : 'Save session', value:'save', kind:'primary' }, { label:'Cancel', value:null }];
  if (own) buttons.push({ label:'Delete', value:'delete', kind:'danger' });
  const r = await showSheet({ title: own ? 'Edit session' : 'Build a session', content: box, buttons, dismissValue:null,
    onAction: v => v === 'save' ? save() : true });
  if (r === 'save' && saved) return { saved };
  if (r === 'delete' && own && await ask('Planned days that use it will show it as missing. Sessions you\'ve logged stay in your history.', { title:'Delete '+workout.name+'?', ok:'Delete', danger:true })){
    const { error } = await supabase.from('strength_workouts').delete().eq('id', workout.id).eq('user_id', user.id);
    if (!error) return { deleted: workout.id };
  }
  return null;
}
