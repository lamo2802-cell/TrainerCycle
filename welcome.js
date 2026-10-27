// First-week setup for new riders: three questions pick a plan, then FTP, then the plan starts on
// Monday and the first session is waiting on Today. Shown on Today until the rider has a plan or a ride.
import { showSheet } from './sheet.js?v=3';
import { mondayOnOrAfter, parseIso } from './plan-schedule.js?v=6';
import { whatsNewRow } from './whatsnew.js?v=1';

export const WELCOME_KEY = 'welcome_done';
const RAMP_TEST_ID = 'prebuilt-ramp-test-25';

const GOALS = [
  { id:'fitness',  label:'Get fitter',         text:'Steady, all-round aerobic fitness.',         phases:['base','foundation'] },
  { id:'ftp',      label:'Raise my FTP',       text:'Get stronger at sustained efforts.',         phases:['build'] },
  { id:'event',    label:'Sharpen for an event', text:'Race or fast group ride coming up.',       phases:['specialty','build'] },
  { id:'long',     label:'A long ride',        text:'Sportive, charity or multi-day ride.',       phases:['foundation','base'], match:/london|paris|endurance/i },
];
const LEVELS = [
  { id:'new', label:'New to structured training' },
  { id:'some', label:'I\'ve followed plans before' },
];
const DAYS = [3, 4, 5];

// Rides a week in a plan's first week (strength and runs don't count).
function ridesPerWeek(plan){
  const w = (plan.weeks || [])[0];
  return w ? (w.days || []).filter(d => d && d.type === 'workout' && d.workoutType !== 'strength' && d.workoutType !== 'run').length : 0;
}
function hasStrength(plan){ return (plan.weeks || []).some(w => (w.days || []).some(d => d && d.workoutType === 'strength')); }

// Best three plans for the answers, best first.
export function recommendPlans(plans, { goal, level, days }){
  const g = GOALS.find(x => x.id === goal) || GOALS[0];
  return plans.map(p => {
    const rides = ridesPerWeek(p);
    let score = Math.abs(rides - days) * 2;
    const pi = g.phases.indexOf(p.phase);
    score += pi < 0 ? 4 : pi;
    if (g.match) score += g.match.test(p.name + ' ' + (p.description || '')) ? -3 : 1;
    if (level === 'new') score += /beginner/i.test(p.name) ? -4 : p.phase === 'specialty' ? 3 : 0;
    else if (/beginner/i.test(p.name)) score += 2;
    return { p, rides, score };
  }).filter(x => x.rides > 0).sort((a, b) => a.score - b.score).slice(0, 3);
}

const CSS = '<style>'
  + '.tc-wel .w-step{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#45D6C4;font-weight:700;margin:0 0 6px}'
  + '.tc-wel .w-q{font-size:12.5px;color:#8B96A5;margin:14px 0 6px;font-weight:600}'
  + '.tc-wel .w-opts{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
  + '.tc-wel .w-opts.three{grid-template-columns:repeat(3,1fr)}.tc-wel .w-opts.one{grid-template-columns:1fr}'
  + '.tc-wel .w-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;width:100%;margin:0;padding:10px 12px;border-radius:10px;'
  + 'background:#1D242D;border:1px solid #2A323D;color:#E7ECF2;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}'
  + '.tc-wel .w-opts.three .w-opt{align-items:center}'
  + '.tc-wel .w-opt span{font-size:12px;font-weight:400;color:#8B96A5;line-height:1.4}'
  + '.tc-wel .w-opt.on{border-color:#45D6C4;background:rgba(69,214,196,.1)}'
  + '.tc-wel .w-tag{font-size:10.5px;font-weight:700;color:#0B0E12;background:#45D6C4;border-radius:5px;padding:1px 6px;margin-bottom:3px;letter-spacing:.04em}'
  + '.tc-wel .w-ftp{display:flex;gap:8px;align-items:center;margin-top:6px}'
  + '.tc-wel .w-ftp input{width:110px;padding:10px 12px;border-radius:9px;background:#10151B;border:1px solid #2A323D;color:#E7ECF2;font-size:16px;font-family:inherit}'
  + '.tc-wel .w-err{color:#FF8A8D;font-size:12.5px;min-height:16px;margin-top:6px}'
  + '.tc-wel p{margin:0 0 4px}'
  + '</style>';
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

// Resolves true when a plan was started.
export async function openWelcome({ supabase, user, ftp }){
  const { data } = await supabase.from('training_plans').select('id,name,phase,description,weeks').order('name');
  const plans = data || []; // shared plans plus the rider's own (RLS)
  const st = { step:0, goal:'fitness', level:'new', days:3, ftp: ftp ? Math.round(ftp) : '', ramp:!ftp, pick:null };
  const box = document.createElement('div');
  box.className = 'tc-wel';
  const start = mondayOnOrAfter(new Date());
  const startLabel = parseIso(start).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
  let recs = [];

  function render(){
    let h = CSS + '<div class="w-step">Step '+(st.step+1)+' of 3</div>';
    if (st.step === 0){
      h += '<p>Three quick questions and we\'ll pick a plan that fits your week.</p>'
        + '<div class="w-q">What are you training for?</div><div class="w-opts">'
        + GOALS.map(g => '<button class="w-opt'+(st.goal === g.id ? ' on' : '')+'" data-k="goal" data-v="'+g.id+'">'+g.label+'<span>'+g.text+'</span></button>').join('')+'</div>'
        + '<div class="w-q">Your experience</div><div class="w-opts">'
        + LEVELS.map(l => '<button class="w-opt'+(st.level === l.id ? ' on' : '')+'" data-k="level" data-v="'+l.id+'">'+l.label+'</button>').join('')+'</div>'
        + '<div class="w-q">Days a week you can ride</div><div class="w-opts three">'
        + DAYS.map(d => '<button class="w-opt'+(st.days === d ? ' on' : '')+'" data-k="days" data-v="'+d+'">'+d+(d === 5 ? '+' : '')+'</button>').join('')+'</div>';
    } else if (st.step === 1){
      h += '<p>Every target is a percentage of your FTP, the power you could hold for about an hour.</p>'
        + '<div class="w-opts one">'
        + '<button class="w-opt'+(!st.ramp ? ' on' : '')+'" data-k="ramp" data-v="0">I know my FTP<span>Type it in and your plan starts on '+esc(startLabel)+'.</span></button>'
        + '<button class="w-opt'+(st.ramp ? ' on' : '')+'" data-k="ramp" data-v="1">Take a Ramp Test first<span>About 20 minutes. It sets your FTP for you, and is waiting on Today.</span></button></div>'
        + (!st.ramp ? '<div class="w-ftp"><input id="wFtp" type="number" inputmode="numeric" min="50" max="600" placeholder="e.g. 220" value="'+esc(st.ftp)+'"><span style="color:#8B96A5">watts</span></div>' : '')
        + '<div class="w-err" id="wErr"></div>';
    } else {
      recs = recommendPlans(plans, st);
      if (!st.pick || !recs.some(r => r.p.id === st.pick)) st.pick = recs[0] && recs[0].p.id;
      h += '<p>Starts '+esc(startLabel)+'. You can move sessions around or switch plans any time.</p><div class="w-opts one" style="margin-top:10px">'
        + recs.map((r, i) => '<button class="w-opt'+(st.pick === r.p.id ? ' on' : '')+'" data-k="pick" data-v="'+esc(r.p.id)+'">'
          + (i === 0 ? '<i class="w-tag">BEST FIT</i>' : '')+esc(r.p.name)
          + '<span>'+plural((r.p.weeks || []).length, 'week')+' · '+r.rides+' rides a week'+(hasStrength(r.p) ? ' + strength' : '')+'.'+(r.p.description ? ' '+esc(r.p.description.split('. ')[0].replace(/\.$/, ''))+'.' : '')+'</span></button>').join('')
        + '</div>' + (recs.length ? '' : '<div class="w-err">No plans found. You can pick one on Training Plans.</div>');
    }
    box.innerHTML = h;
    const btns = box.closest('.tc-sheet') && box.closest('.tc-sheet').querySelectorAll('.tc-sheet-btns button');
    if (btns && btns.length === 2){
      btns[0].textContent = st.step === 2 ? 'Start plan' : 'Next';
      btns[1].textContent = st.step === 0 ? 'Later' : 'Back';
    }
  }
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k, v = b.dataset.v;
    if (k === 'ftp') return;
    const inp = box.querySelector('#wFtp'); if (inp) st.ftp = inp.value;
    st[k] = k === 'days' ? Number(v) : k === 'ramp' ? v === '1' : v;
    render();
    const again = box.querySelector('#wFtp'); if (again && k === 'ramp') again.focus();
  });
  render();

  async function save(){
    const now = new Date().toISOString();
    const rows = [
      { user_id:user.id, key:'active_plan_id', value:{ v:st.pick }, updated_at:now },
      { user_id:user.id, key:'active_plan_started_at', value:{ v:start }, updated_at:now },
      { user_id:user.id, key:'active_plan_cursor_day', value:{ v:0 }, updated_at:now },
      { user_id:user.id, key:WELCOME_KEY, value:{ v:{ at:now, goal:st.goal, level:st.level, days:st.days, ramp:st.ramp } }, updated_at:now },
      whatsNewRow(user), // everything on the What's new list is new to them anyway
    ];
    if (!st.ramp && st.ftp) rows.push({ user_id:user.id, key:'ftp', value:{ v:Number(st.ftp) }, updated_at:now });
    await supabase.from('settings').delete().eq('user_id', user.id).in('key', ['active_plan_moves', 'active_plan_swaps', 'active_plan_skips', 'run_plan']);
    const { error } = await supabase.from('settings').upsert(rows, { onConflict:'user_id,key' });
    if (error) throw error;
    if (!st.ramp && st.ftp) try { localStorage.setItem('tc_ftp_' + user.id, String(Number(st.ftp))); } catch(_){}
  }

  const res = await showSheet({
    title:'Set up your first week', content:box, dismissValue:'later',
    buttons:[{ label:'Next', value:'next', kind:'primary' }, { label:'Later', value:'back' }],
    onAction: async v => {
      const inp = box.querySelector('#wFtp'); if (inp) st.ftp = inp.value;
      if (v === 'back'){ if (st.step === 0) return true; st.step--; render(); return false; }
      if (st.step === 1 && !st.ramp){
        const n = Number(st.ftp);
        if (!(n >= 50 && n <= 600)){ box.querySelector('#wErr').textContent = 'Enter your FTP in watts, between 50 and 600.'; return false; }
      }
      if (st.step < 2){ st.step++; render(); return false; }
      if (!st.pick) return false;
      try { await save(); return true; }
      catch(_){ box.insertAdjacentHTML('beforeend', '<div class="w-err">Couldn\'t save. Check your connection and try again.</div>'); return false; }
    },
  });
  return res === 'next' ? { started:true, ramp:st.ramp } : null;
}

export { RAMP_TEST_ID };
