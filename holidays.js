// Holidays: date ranges the rider marks on the calendar (settings key `holidays`,
// [{ id, name, start:'YYYY-MM-DD', end:'YYYY-MM-DD', mode }]). While away, the followed plan changes:
//   off  - no training: every session those days becomes a rest day
//   easy - easy sessions only: rides become a short endurance ride, runs an easy run, strength is dropped
//   keep - keep the plan as it is (the days are still shown as away on the calendar)
// applyHolidays() runs on the plan after addRuns() and applySwaps(), so the rest of the app just sees
// rest days or easier sessions. The plan keeps its length; the week after a holiday picks up as planned.
import { planStart, addDays, parseIso } from './plan-schedule.js?v=2';
import { showSheet } from './sheet.js?v=2';

export const HOLIDAYS_KEY = 'holidays';
export const HOLIDAY_MODES = [
  { id:'off',  label:'No training',        text:'A proper break. Sessions those days come off the plan.' },
  { id:'easy', label:'Easy sessions only', text:'Rides become a 45 minute endurance ride and runs an easy 30 minutes.' },
  { id:'keep', label:'Keep my plan',       text:'Training as normal, just marked on the calendar.' },
];
const EASY_RIDE = 'prebuilt-endurance-45', EASY_DELOAD_RIDE = 'prebuilt-recovery-45', EASY_RUN = 'run-easy-30';

export async function loadHolidays(supabase, userId){
  try {
    const { data } = await supabase.from('settings').select('value').eq('user_id', userId).eq('key', HOLIDAYS_KEY).maybeSingle();
    return (data && data.value && Array.isArray(data.value.v)) ? data.value.v : [];
  } catch(_){ return []; }
}
async function saveHolidays(supabase, userId, list){
  const { error } = await supabase.from('settings').upsert({ user_id:userId, key:HOLIDAYS_KEY, value:{v:list}, updated_at:new Date().toISOString() }, { onConflict:'user_id,key' });
  if (error) throw error;
}

export function holidayOn(date, holidays){
  return (holidays || []).find(h => date >= h.start && date <= h.end) || null;
}

export function applyHolidays(plan, startedAtIso, moves, holidays){
  const active = (holidays || []).filter(h => h.mode !== 'keep');
  if (!plan || !startedAtIso || !active.length) return plan;
  const start = planStart(startedAtIso);
  return Object.assign({}, plan, { weeks: (plan.weeks||[]).map((w, wi)=> Object.assign({}, w, {
    days: (w.days||[]).map((d, di)=>{
      if (!d || d.type !== 'workout') return d;
      const dayIndex = wi*7 + di;
      const h = holidayOn((moves && moves[dayIndex]) || addDays(start, dayIndex), active);
      if (!h) return d;
      if (h.mode === 'off' || d.workoutType === 'strength') return { day: d.day, type:'rest', holiday: h.name || 'Holiday' };
      const to = d.workoutType === 'run' ? EASY_RUN : (w.deload ? EASY_DELOAD_RIDE : EASY_RIDE);
      return to === d.workoutId ? d : Object.assign({}, d, { workoutId: to, swappedFrom: d.swappedFrom || d.workoutId, holiday: h.name || 'Holiday' });
    })
  })) });
}

function fmtRange(h){
  const opt = { day:'numeric', month:'short' };
  const a = parseIso(h.start).toLocaleDateString('en-GB', opt), b = parseIso(h.end).toLocaleDateString('en-GB', opt);
  return h.start === h.end ? a : a + ' – ' + b;
}
export function holidayLabel(h){ return (h.name || 'Holiday') + ' · ' + fmtRange(h); }

// Add (no `existing`) or edit a holiday. Resolves with the new list, or null if nothing changed.
export async function openHolidaySheet(supabase, userId, holidays, { existing = null, date = null } = {}){
  const h = existing || { name:'', start: date || new Date().toISOString().slice(0,10), end: date || new Date().toISOString().slice(0,10), mode:'easy' };
  const form = document.createElement('div');
  form.className = 'hol-form';
  form.innerHTML = '<style>.hol-form label{ display:block; font-size:12.5px; color:#8C97A6; margin:10px 0 4px; }'
    + '.hol-form input{ width:100%; box-sizing:border-box; background:#0F1318; border:1px solid #2A323D; border-radius:8px; color:#E7ECF2; padding:10px; font:inherit; font-size:14.5px; }'
    + '.hol-form .two{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }'
    + '.hol-form .modes{ display:flex; flex-direction:column; gap:6px; }'
    + '.hol-form .mode{ display:flex; gap:10px; align-items:flex-start; text-align:left; background:#1D242D; border:1px solid #2A323D; border-radius:9px; padding:10px 12px; cursor:pointer; color:#E7ECF2; font:inherit; width:100%; margin:0; }'
    + '.hol-form .mode.on{ border-color:#45D6C4; background:rgba(69,214,196,.08); }'
    + '.hol-form .mode b{ display:block; font-size:14px; } .hol-form .mode span{ font-size:12.5px; color:#8C97A6; }'
    + '.hol-form .err{ color:#FF8A8D; font-size:12.5px; min-height:16px; margin-top:8px; }</style>'
    + '<label for="holName">Name</label><input id="holName" maxlength="40" placeholder="e.g. Lake District">'
    + '<div class="two"><div><label for="holStart">From</label><input type="date" id="holStart"></div><div><label for="holEnd">Until</label><input type="date" id="holEnd"></div></div>'
    + '<label>While you\'re away</label><div class="modes">'
    + HOLIDAY_MODES.map(m => '<button type="button" class="mode" data-mode="'+m.id+'"><div><b>'+m.label+'</b><span>'+m.text+'</span></div></button>').join('')
    + '</div><div class="err" id="holErr"></div>';
  form.querySelector('#holName').value = h.name || '';
  form.querySelector('#holStart').value = h.start;
  form.querySelector('#holEnd').value = h.end;
  let mode = h.mode || 'easy';
  const paint = () => form.querySelectorAll('.mode').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  form.querySelectorAll('.mode').forEach(b => b.addEventListener('click', ()=>{ mode = b.dataset.mode; paint(); }));
  paint();
  form.querySelector('#holStart').addEventListener('change', e=>{
    const end = form.querySelector('#holEnd');
    if (!end.value || end.value < e.target.value) end.value = e.target.value;
  });

  let result = null;
  const buttons = [{ label: existing ? 'Save' : 'Add holiday', value:'save', kind:'primary' }, { label:'Cancel', value:null }];
  if (existing) buttons.splice(1, 0, { label:'Remove holiday', value:'remove', kind:'danger' });
  const choice = await showSheet({ title: existing ? 'Edit holiday' : 'Add a holiday', content: form, buttons,
    onAction: async v => {
      if (v === null) return true;
      const err = form.querySelector('#holErr');
      let list = holidays.filter(x => !existing || x.id !== existing.id);
      if (v === 'save'){
        const start = form.querySelector('#holStart').value, end = form.querySelector('#holEnd').value;
        if (!start || !end || end < start){ err.textContent = 'Pick the dates you\'re away, with the last day on or after the first.'; return false; }
        if ((parseIso(end) - parseIso(start)) / 86400000 > 60){ err.textContent = 'Holidays can be up to two months.'; return false; }
        if (list.some(x => start <= x.end && end >= x.start)){ err.textContent = 'That overlaps another holiday.'; return false; }
        list = list.concat({ id: existing ? existing.id : 'h' + Date.now().toString(36), name: form.querySelector('#holName').value.trim(), start, end, mode })
          .sort((a,b)=> a.start < b.start ? -1 : 1);
      }
      try { await saveHolidays(supabase, userId, list); result = list; return true; }
      catch(_){ err.textContent = 'Couldn\'t save. Check your connection and try again.'; return false; }
    } });
  return choice ? result : null;
}
