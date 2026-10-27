// Fitness & form chart (Progress → Fitness) and the planned sessions it projects forward with.
// The tiles alone also show on Calendar and Today, from training-load.js.
import { isoDate, parseIso, addDays, daysBetween, todayIso, planSessions, loadFollowState, loadDoneDays, isSkipped } from './plan-schedule.js?v=6';
import { loadSeries, formLabel } from './training-load.js?v=2';
import { applySwaps } from './adapt.js?v=5';
import { loadHolidays, applyHolidays } from './holidays.js?v=3';
import { composeFollowed, loadPlanRow } from './run-plans.js?v=4';
import { sessionInfo } from './plan-kit.js?v=4';
import { loadDiary, diarySessions } from './diary.js?v=1';
import { setRunPace, RUN_PACE_KEY } from './run.js?v=6';
import { setSwimCss, SWIM_CSS_KEY } from './swim.js?v=2';

// Every planned session (followed plan and single calendar workouts) as
// { date, tss, done, missed, skipped, sport }. rides: completed_rides rows with started_at, sport, plan_id.
export async function loadPlanned(supabase, userId, rides){
  const [st, wRes, sRes, setRes, hol, diary] = await Promise.all([
    loadFollowState(supabase, userId),
    supabase.from('workouts').select('id,name,category,steps,duration_sec'),
    supabase.from('strength_workouts').select('id,name'),
    supabase.from('settings').select('key,value').eq('user_id', userId).in('key', ['ftp', RUN_PACE_KEY, SWIM_CSS_KEY]),
    loadHolidays(supabase, userId),
    loadDiary(supabase, userId),
  ]);
  const set = {}; (setRes.data || []).forEach(r => { set[r.key] = r.value && r.value.v; });
  setRunPace(set[RUN_PACE_KEY]); setSwimCss(set[SWIM_CSS_KEY]);
  const ftp = Number(set.ftp) || 200;
  const workouts = {};
  (wRes.data || []).forEach(w => { workouts[w.id] = w; });
  (sRes.data || []).forEach(w => { workouts[w.id] = { name:w.name, category:'strength' }; });
  const today = todayIso();
  const sportOf = d => ({ run:'run', swim:'swim', strength:'strength', race:'race' })[d.workoutType] || 'ride';
  const out = diarySessions(diary, workouts, ftp, rides).map(s => ({ date:s.date, tss:s.tss || 0, done:s.done, skipped:false, missed:!s.done && s.date < today, sport:sportOf(s.dayObj) }));
  if (st.planId && st.startedAt){
    const base = composeFollowed(await loadPlanRow(supabase, st), st, st.runPlan).plan;
    const plan = base ? applyHolidays(applySwaps(base, st.swaps), st.startedAt, st.moves, hol || []) : null;
    if (plan){
      const doneDays = await loadDoneDays(supabase, userId, plan.id, st.startedAt);
      planSessions(plan, st.startedAt, st.moves).forEach(s => {
        const info = sessionInfo(s.dayObj, workouts, ftp) || {};
        const done = doneDays.has(s.dayIndex), skipped = isSkipped(st, s);
        out.push({ date:s.date, tss:info.tss || 0, done, skipped, missed:!done && (s.date < today || skipped), sport:sportOf(s.dayObj) });
      });
    }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

const CHART_BACK = 90, CHART_AHEAD_MAX = 42;
const PANEL = `
<div class="fit-tiles">
  <div class="fit-tile"><div class="lbl"><i style="background:var(--s-fitness)"></i>Fitness</div><div class="val" data-t="fitness">—</div><div class="note">42-day load</div></div>
  <div class="fit-tile"><div class="lbl"><i style="background:var(--s-fatigue)"></i>Fatigue</div><div class="val" data-t="fatigue">—</div><div class="note">7-day load</div></div>
  <div class="fit-tile"><div class="lbl"><i style="background:var(--s-form)"></i>Form</div><div class="val" data-t="form">—</div><div class="note" data-t="formNote">&nbsp;</div></div>
  <div class="fit-tile"><div class="lbl">This week</div><div class="val" data-t="week">—</div><div class="note" data-t="weekNote">TSS done</div></div>
</div>
<div class="panel">
  <div class="panel-title"><span>Fitness, fatigue and form</span>
    <div class="fit-legend">
      <span class="series"><i style="background:var(--s-fitness)"></i>Fitness</span>
      <span class="series"><i style="background:var(--s-fatigue)"></i>Fatigue</span>
      <span class="series"><i style="background:var(--s-form)"></i>Form</span>
      <span data-t="legendPlanned" style="display:none;"><i class="dash"></i>If you do the plan</span>
    </div>
  </div>
  <div class="seg fit-range" role="group" aria-label="Time range"><button data-back="42">6 wks</button><button data-back="90" class="on">3 mths</button><button data-back="180">6 mths</button><button data-back="365">1 year</button></div>
  <div class="chart-wrap"><canvas class="fit-chart"></canvas><div class="chart-tip"></div></div>
  <div class="fit-explain">Fitness is your average daily TSS over the last six weeks, Fatigue over the last week, and Form is Fitness minus Fatigue. Hard weeks push Form negative; a rest week lets it bounce back before a test or event. The dashed lines show where your plan takes you if you do every session.</div>
</div>`;

// el: an empty container. rides: activities with started_at and tss. planned: from loadPlanned().
export function mountFitness(el, { rides, planned }){
  el.innerHTML = PANEL;
  const q = k => el.querySelector('[data-t="'+k+'"]');
  const canvas = el.querySelector('.fit-chart'), tip = el.querySelector('.chart-tip');
  const today = todayIso();
  let back = CHART_BACK, all = [], series = [], geom = null;

  const daily = new Map();
  (rides || []).forEach(r => { if (r.tss != null){ const d = isoDate(new Date(r.started_at)); daily.set(d, (daily.get(d) || 0) + r.tss); } });
  let ahead = 0;
  (planned || []).forEach(s => { if (s.date > today && !s.done && !s.skipped && s.tss){ daily.set(s.date, (daily.get(s.date) || 0) + s.tss); ahead = Math.max(ahead, daysBetween(today, s.date)); } });
  ahead = Math.min(CHART_AHEAD_MAX, ahead);
  const firstDay = [...daily.keys()].sort()[0] || today;
  all = loadSeries(daily, firstDay < addDays(today, -365) ? firstDay : addDays(today, -365), addDays(today, ahead), today);
  q('legendPlanned').style.display = ahead > 0 ? '' : 'none';

  const now = all.find(p => p.date === today) || all[all.length-1];
  const form = Math.round(now.ctl - now.atl);
  q('fitness').textContent = Math.round(now.ctl);
  q('fatigue').textContent = Math.round(now.atl);
  q('form').textContent = (form > 0 ? '+' : '') + form;
  q('formNote').textContent = formLabel(form);
  const mon = addDays(today, -((parseIso(today).getDay()+6)%7));
  let wkDone = 0, wkPlanned = 0;
  for (let i = 0; i < 7; i++){
    const d = addDays(mon, i);
    if (d <= today) wkDone += Math.round(all.find(p => p.date === d)?.tss || 0);
  }
  (planned || []).forEach(s => { if (s.date >= mon && s.date <= addDays(mon, 6)) wkPlanned += s.tss || 0; });
  q('week').textContent = wkDone;
  q('weekNote').textContent = wkPlanned ? 'of '+wkPlanned+' planned TSS' : 'TSS done';

  function pick(){ series = all.filter(p => p.date >= addDays(today, -back)); }
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const longDate = iso => parseIso(iso).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
  function draw(hoverIdx){
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = Math.round(W*dpr); canvas.height = Math.round(H*dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);
    const pts = series;
    if (pts.length < 2) return;
    const pad = { l:34, r:52, t:10, b:22 };
    let lo = 0, hi = 10;
    pts.forEach(p => { hi = Math.max(hi, p.ctl, p.atl, p.tsb); lo = Math.min(lo, p.tsb); });
    hi = Math.ceil(hi/10)*10; lo = Math.floor(lo/10)*10;
    const x = i => pad.l + (W - pad.l - pad.r) * i / (pts.length - 1);
    const y = v => pad.t + (H - pad.t - pad.b) * (hi - v) / (hi - lo || 1);
    geom = { x, pad, W, n: pts.length };
    const dim = cssVar('--text-dim'), line = cssVar('--line');
    ctx.font = '11px ' + cssVar('--mono');
    const step = (hi - lo) > 120 ? 40 : (hi - lo) > 60 ? 20 : 10;
    ctx.fillStyle = dim; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = lo; v <= hi; v += step){
      ctx.strokeStyle = v === 0 ? dim : line; ctx.globalAlpha = v === 0 ? .6 : 1; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, Math.round(y(v))+.5); ctx.lineTo(W - pad.r, Math.round(y(v))+.5); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillText(String(v), pad.l - 6, y(v));
    }
    // daily TSS as faint bars at the base
    const maxT = Math.max(1, ...pts.map(p => p.tss));
    const bw = Math.max(1, (W - pad.l - pad.r) / pts.length - 1);
    const base = y(lo), barH = (H - pad.t - pad.b) * 0.28;
    pts.forEach((p, i) => { if (!p.tss) return;
      ctx.fillStyle = dim; ctx.globalAlpha = p.future ? .12 : .22;
      const h = barH * p.tss / maxT; ctx.fillRect(x(i) - bw/2, base - h, bw, h); });
    ctx.globalAlpha = 1;
    // month ticks (every other month on a year)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = dim;
    pts.forEach((p, i) => { if (p.date.endsWith('-01') && (back < 300 || Number(p.date.slice(5,7)) % 2)) ctx.fillText(parseIso(p.date).toLocaleString('en-GB', { month:'short' }), x(i), H - pad.b + 6); });
    const ti = pts.findIndex(p => p.future);
    const todayI = ti === -1 ? pts.length - 1 : ti - 1;
    ctx.strokeStyle = cssVar('--accent'); ctx.globalAlpha = .5; ctx.setLineDash([2,3]);
    ctx.beginPath(); ctx.moveTo(x(todayI)+.5, pad.t); ctx.lineTo(x(todayI)+.5, H - pad.b); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const lines = [['tsb','--s-form'],['atl','--s-fatigue'],['ctl','--s-fitness']];
    lines.forEach(([k, c]) => {
      ctx.strokeStyle = cssVar(c); ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); for (let i = 0; i <= todayI; i++){ i ? ctx.lineTo(x(i), y(pts[i][k])) : ctx.moveTo(x(i), y(pts[i][k])); } ctx.stroke();
      if (todayI < pts.length - 1){
        ctx.setLineDash([5,4]); ctx.globalAlpha = .8;
        ctx.beginPath(); for (let i = todayI; i < pts.length; i++){ i === todayI ? ctx.moveTo(x(i), y(pts[i][k])) : ctx.lineTo(x(i), y(pts[i][k])); } ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    });
    const last = pts[pts.length-1];
    const labels = [['Fitness', last.ctl], ['Fatigue', last.atl], ['Form', last.tsb]].map(([t, v]) => ({ t, yy: y(v) })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < labels.length; i++) if (labels[i].yy - labels[i-1].yy < 13) labels[i].yy = labels[i-1].yy + 13;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = cssVar('--text');
    labels.forEach(l => ctx.fillText(l.t, W - pad.r + 6, l.yy));
    if (hoverIdx != null && pts[hoverIdx]){
      const p = pts[hoverIdx];
      ctx.strokeStyle = dim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x(hoverIdx)+.5, pad.t); ctx.lineTo(x(hoverIdx)+.5, H - pad.b); ctx.stroke();
      lines.forEach(([k, c]) => { ctx.fillStyle = cssVar(c); ctx.strokeStyle = cssVar('--panel'); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x(hoverIdx), y(p[k]), 4, 0, Math.PI*2); ctx.fill(); ctx.stroke(); });
    }
  }
  function showTip(clientX){
    if (!geom) return;
    const rect = canvas.getBoundingClientRect();
    const { pad, W, n } = geom;
    let i = Math.round((clientX - rect.left - pad.l) / (W - pad.l - pad.r) * (n - 1));
    i = Math.max(0, Math.min(n-1, i));
    const p = series[i];
    draw(i);
    tip.innerHTML = '<div class="d">'+longDate(p.date)+(p.future ? ' · planned' : '')+'</div>'
      + '<div class="r"><i style="background:var(--s-fitness)"></i>Fitness '+Math.round(p.ctl)+'</div>'
      + '<div class="r"><i style="background:var(--s-fatigue)"></i>Fatigue '+Math.round(p.atl)+'</div>'
      + '<div class="r"><i style="background:var(--s-form)"></i>Form '+Math.round(p.tsb)+'</div>'
      + '<div class="r" style="color:var(--text-dim)">TSS '+Math.round(p.tss)+'</div>';
    tip.style.display = 'block';
    const tx = geom.x(i);
    tip.style.left = Math.min(W - tip.offsetWidth, Math.max(0, tx + 12 > W - tip.offsetWidth ? tx - tip.offsetWidth - 12 : tx + 12)) + 'px';
  }
  canvas.addEventListener('pointermove', e => showTip(e.clientX));
  canvas.addEventListener('pointerdown', e => showTip(e.clientX));
  canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; draw(); });
  el.querySelector('.fit-range').addEventListener('click', e => {
    const b = e.target.closest('[data-back]'); if (!b) return;
    back = Number(b.dataset.back);
    el.querySelectorAll('.fit-range button').forEach(x => x.classList.toggle('on', x === b));
    pick(); draw();
  });
  pick(); draw();
  let t = null;
  const onResize = () => { clearTimeout(t); t = setTimeout(() => { if (canvas.isConnected) draw(); else window.removeEventListener('resize', onResize); }, 150); };
  window.addEventListener('resize', onResize);
}

export const FITNESS_CSS = `
  .fit-tiles{ display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; margin-bottom:14px; }
  .fit-tile{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .fit-tile .lbl{ font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:.05em; display:flex; align-items:center; gap:6px; }
  .fit-tile .lbl i{ width:10px; height:3px; border-radius:2px; display:inline-block; }
  .fit-tile .val{ font-family:var(--mono); font-size:26px; font-weight:600; margin-top:2px; }
  .fit-tile .note{ font-size:12px; color:var(--text-dim); }
  @media (max-width:600px){ .fit-tiles{ grid-template-columns:repeat(2, minmax(0,1fr)); } .fit-tile .val{ font-size:22px; } .fit-legend .series{ display:none; } }
  .fit-legend{ display:flex; gap:16px; font-size:12px; color:var(--text-dim); flex-wrap:wrap; text-transform:none; letter-spacing:0; }
  .fit-legend span{ display:flex; align-items:center; gap:6px; }
  .fit-legend i{ width:14px; height:3px; border-radius:2px; display:inline-block; }
  .fit-legend i.dash{ background:repeating-linear-gradient(90deg, var(--text-dim) 0 4px, transparent 4px 7px) !important; }
  .fit-range{ margin-bottom:10px; }
  .chart-wrap{ position:relative; }
  .fit-chart{ width:100%; height:260px; display:block; touch-action:pan-y; }
  .chart-tip{ position:absolute; top:0; pointer-events:none; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:12px; white-space:nowrap; display:none; z-index:5; }
  .chart-tip .d{ color:var(--text-dim); margin-bottom:4px; }
  .chart-tip .r{ display:flex; align-items:center; gap:6px; font-family:var(--mono); }
  .chart-tip .r i{ width:10px; height:3px; border-radius:2px; display:inline-block; }
  .fit-explain{ font-size:12px; color:var(--text-dim); margin-top:10px; line-height:1.5; }
`;
