// Progress → Strength: how lifting is going. Built from logged sets (strength-kit loadHistory) and the
// body weight log. Charts are inline SVG and share Performance's styles (pf-*) and hover tooltip.
import { VARIANTS, e1rm, fmtLoad, fmtKg, muscleGroup } from './strength-kit.js?v=6';
import { todayIso, addDays, isoDate, parseIso } from './plan-schedule.js?v=5';

const GROUPS = [
  { id:'legs', label:'Legs', color:'#c98500' },
  { id:'push', label:'Push', color:'#3987e5' },
  { id:'pull', label:'Pull', color:'#199e70' },
  { id:'core', label:'Core', color:'#a66fd6' },
];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dayOf = iso => isoDate(new Date(iso));
const mondayOf = iso => addDays(iso, -((parseIso(iso).getDay()+6)%7));
const shortDay = iso => parseIso(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
// A hard set: anything not stopped with 4 or more reps left. Sets logged without effort count too.
const hard = s => s.rir == null || s.rir <= 3;

// Every logged set, flat: { at, day, variant, group, rir, ... }
function flatSets(history){
  const out = [];
  Object.entries(history).forEach(([vid, sessions]) => sessions.forEach(sess => sess.sets.forEach(s => {
    const base = (VARIANTS[vid] && VARIANTS[vid].base) || s.exercise_key;
    out.push(Object.assign({}, s, { at: s.performed_at || sess.at, day: dayOf(s.performed_at || sess.at), variant: vid, group: muscleGroup(base), session_id: sess.session_id }));
  })));
  return out;
}

// Per-session best for a variation, oldest first: estimated max, best reps or longest hold.
function trend(vid, sessions){
  const v = VARIANTS[vid] || { load:'bw' };
  return sessions.slice().reverse().map(sess => {
    let y = 0;
    sess.sets.forEach(s => {
      const val = v.load === 'time' ? (s.hold_sec || 0) : v.load === 'bw' ? (s.reps || 0) : (e1rm(s.weight_kg, s.reps) || 0);
      if (val > y) y = val;
    });
    return { day: dayOf(sess.at), y };
  }).filter(p => p.y > 0);
}
const valText = (vid, y) => { const v = VARIANTS[vid] || { load:'bw' }; return v.load === 'time' ? Math.round(y) + ' s' : v.load === 'bw' ? Math.round(y) + ' reps' : fmtLoad(vid, Math.round(y*2)/2); };

function tilesHtml(sets, history, log, today){
  const a0 = addDays(today, -27), b0 = addDays(today, -55);
  const cur = sets.filter(s => s.day >= a0), prev = sets.filter(s => s.day >= b0 && s.day < a0);
  const sessions = l => new Set(l.map(s => s.session_id)).size;
  const delta = (now, before) => before ? Math.round((now - before) / before * 100) : null;
  const tile = (label, val, note) => '<div class="pf-tile"><div class="lbl">'+label+'</div><div class="val">'+val+'</div><div class="note">'+note+'</div></div>';
  const vs = (now, before) => { const d = delta(now, before); return d == null ? 'last 4 weeks' : (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '')+Math.abs(d)+'% on the 4 before'; };
  // New bests in the last 4 weeks: variations whose best session is recent and beat an earlier one.
  let bests = 0;
  Object.entries(history).forEach(([vid, sessions]) => {
    const t = trend(vid, sessions); if (t.length < 2) return;
    // Against everything before the 4 weeks, or the first session in them for a lift that's new.
    let before = t.filter(p => p.day < a0), after = t.filter(p => p.day >= a0);
    if (!before.length){ before = after.slice(0, 1); after = after.slice(1); }
    if (after.length && Math.max(...after.map(p => p.y)) > Math.max(...before.map(p => p.y))) bests++;
  });
  const lastW = log.length ? log[log.length-1] : null;
  const monthAgo = lastW ? log.filter(e => e.date <= addDays(lastW.date, -28)).pop() : null;
  const wd = lastW && monthAgo ? Math.round((lastW.kg - monthAgo.kg) * 10) / 10 : null;
  return '<div class="pf-tiles">'
    + tile('Sessions', sessions(cur), vs(sessions(cur), sessions(prev)))
    + tile('Hard sets a week', Math.round(cur.filter(hard).length / 4), vs(cur.filter(hard).length, prev.filter(hard).length))
    + tile('New bests', bests, 'lifts up in the last 4 weeks')
    + tile('Body weight', lastW ? fmtKg(lastW.kg)+' kg' : '—', wd == null ? (lastW ? 'logged '+shortDay(lastW.date) : 'log it below') : (wd > 0 ? '+' : '')+fmtKg(wd)+' kg in 4 weeks')
    + '</div>';
}

// Weekly hard sets by muscle group, last 8 weeks, stacked.
function weeklyHtml(sets, today, W){
  const mon = mondayOf(today), weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push({ mon: addDays(mon, -7*i), by:{} });
  sets.filter(hard).forEach(s => { const w = weeks.find(x => s.day >= x.mon && s.day <= addDays(x.mon, 6)); if (w) w.by[s.group] = (w.by[s.group] || 0) + 1; });
  const used = GROUPS.filter(g => weeks.some(w => w.by[g.id]));
  if (!used.length) return '<div class="empty-note">Log sets in TrainerStrength and your weekly sets by muscle group show here.</div>';
  const step = niceMax(Math.max(1, ...weeks.map(w => Object.values(w.by).reduce((a, b) => a + b, 0))) / 4), max = step * 4;
  const H = 190, pad = { l:32, r:8, t:10, b:22 };
  const slot = (W - pad.l - pad.r) / weeks.length, bw = Math.min(26, slot * 0.6);
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  let g = '';
  for (let i = 0; i <= 4; i++){ const v = max * i / 4, yy = y(v).toFixed(1);
    g += '<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--line)"/><text x="'+(pad.l-6)+'" y="'+(Number(yy)+4)+'" text-anchor="end">'+Math.round(v)+'</text>'; }
  weeks.forEach((w, i) => {
    const cx = pad.l + slot * (i + .5);
    const segs = used.filter(gp => w.by[gp.id]);
    const total = segs.reduce((a, gp) => a + w.by[gp.id], 0);
    let base = 0;
    segs.forEach((gp, k) => {
      const y1 = y(base + w.by[gp.id]), y0 = y(base), h = Math.max(0, y0 - y1 - (k ? 2 : 0));
      g += '<rect x="'+(cx-bw/2).toFixed(1)+'" y="'+y1.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="'+(k === segs.length-1 ? 3 : 0)+'" fill="'+gp.color+'"/>';
      base += w.by[gp.id];
    });
    const tip = shortDay(w.mon)+' week: '+total+' hard sets'+(segs.length ? '\n'+segs.map(gp => gp.label+' '+w.by[gp.id]).join('\n') : '');
    g += '<rect class="hit" x="'+(cx-slot/2).toFixed(1)+'" y="'+pad.t+'" width="'+slot.toFixed(1)+'" height="'+(H-pad.t-pad.b)+'" fill="transparent" data-tip="'+esc(tip)+'"/>';
    if ((weeks.length - 1 - i) % Math.ceil(48 / slot) === 0) g += '<text x="'+cx.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+shortDay(w.mon)+'</text>';
  });
  const legend = '<div class="pf-legend">'+used.map(gp => '<span><i style="background:'+gp.color+'"></i>'+gp.label+'</span>').join('')+'</div>';
  return legend + '<svg class="pf-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Hard sets each week by muscle group, last 8 weeks">'+g+'</svg>' + balanceNote(sets, today);
}
// One plain line when the last 4 weeks are lopsided.
function balanceNote(sets, today){
  const recent = sets.filter(s => s.day >= addDays(today, -27) && hard(s));
  const n = id => recent.filter(s => s.group === id).length;
  const push = n('push'), pull = n('pull'), core = n('core'), total = recent.length;
  let msg = null;
  if (push >= 8 && pull < push / 2) msg = 'You did '+push+' push sets and '+pull+' pull sets in the last 4 weeks. Adding rows balances your shoulders and helps your position on the bike.';
  else if (pull >= 8 && push < pull / 3) msg = 'Mostly pulling lately. A few push-ups or presses keep things balanced.';
  else if (total >= 20 && core === 0) msg = 'No core work in the last 4 weeks. Planks help you hold your position on the bike.';
  return msg ? '<div class="sp-note">'+esc(msg)+'</div>' : '';
}

function sparkSvg(points, w, h){
  if (points.length < 2) return '';
  const lo = Math.min(...points.map(p => p.y)), hi = Math.max(...points.map(p => p.y)), span = hi - lo || 1;
  const X = i => 3 + (w - 6) * i / (points.length - 1), Y = v => 3 + (h - 6) * (1 - (v - lo) / span);
  const d = points.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.y).toFixed(1)).join('');
  const last = points[points.length-1];
  return '<svg class="sp-spark" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" aria-hidden="true"><path d="'+d+'" fill="none" stroke="#45D6C4" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<circle cx="'+X(points.length-1).toFixed(1)+'" cy="'+Y(last.y).toFixed(1)+'" r="3" fill="#45D6C4"/></svg>';
}
// Lifts with 2+ sessions in the last 6 months, most recently done first.
function liftsHtml(history, today){
  const since = addDays(today, -182);
  const rows = Object.entries(history).map(([vid, sessions]) => ({ vid, t: trend(vid, sessions).filter(p => p.day >= since) }))
    .filter(r => r.t.length >= 2).sort((a, b) => a.t[a.t.length-1].day < b.t[b.t.length-1].day ? 1 : -1).slice(0, 10);
  if (!rows.length) return '<div class="empty-note">Do a lift in two sessions and its trend shows here.</div>';
  return '<div class="sp-lifts">' + rows.map(({ vid, t }) => {
    const v = VARIANTS[vid] || { name: vid, load:'bw' }, first = t[0], last = t[t.length-1];
    const best = Math.max(...t.map(p => p.y)), d = last.y - first.y;
    const unit = v.load === 'time' ? 'Longest hold' : v.load === 'bw' ? 'Best reps' : 'Estimated max';
    const change = Math.abs(d) < 0.25 ? 'Level since '+shortDay(first.day)
      : (d > 0 ? '▲ ' : '▼ ')+(v.load === 'time' ? Math.round(Math.abs(d))+' s' : v.load === 'bw' ? Math.round(Math.abs(d))+' reps' : fmtKg(Math.round(Math.abs(d)*2)/2)+' kg')+' since '+shortDay(first.day);
    return '<div class="sp-lift"><div class="sp-ln"><b>'+esc(v.name)+'</b><span>'+unit+' '+valText(vid, last.y)+(last.y < best ? ' · best '+valText(vid, best) : '')+'</span><span class="'+(d > 0.25 ? 'up' : d < -0.25 ? 'down' : '')+'">'+change+'</span></div>'+sparkSvg(t, 120, 40)+'</div>';
  }).join('') + '</div>';
}

function weightHtml(log, today, W){
  const pts = log.filter(e => e.date >= addDays(today, -365));
  let chart = '';
  if (pts.length >= 2){
    const H = 170, pad = { l:40, r:10, t:10, b:22 };
    const t0 = parseIso(pts[0].date).getTime(), t1 = Math.max(parseIso(pts[pts.length-1].date).getTime(), t0 + 86400000);
    let lo = Math.min(...pts.map(p => p.kg)), hi = Math.max(...pts.map(p => p.kg));
    lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
    const step = [1,2,5,10].find(s => (hi - lo) / s <= 4) || 20;
    lo = Math.floor(lo/step)*step; hi = Math.ceil(hi/step)*step;
    const X = iso => pad.l + (W - pad.l - pad.r) * (parseIso(iso).getTime() - t0) / (t1 - t0), Y = v => pad.t + (H - pad.t - pad.b) * (hi - v) / (hi - lo);
    let g = '';
    for (let v = lo; v <= hi; v += step){ const yy = Y(v).toFixed(1); g += '<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--line)"/><text x="'+(pad.l-6)+'" y="'+(Number(yy)+4)+'" text-anchor="end">'+v+'</text>'; }
    // Trend: average of the entries in the 14 days up to each one, so a single weigh-in doesn't swing it.
    const avg = pts.map(p => { const w = pts.filter(q => q.date <= p.date && q.date > addDays(p.date, -14)); return { date:p.date, kg: w.reduce((a, q) => a + q.kg, 0) / w.length }; });
    g += '<path d="'+avg.map((p, i) => (i ? 'L' : 'M')+X(p.date).toFixed(1)+','+Y(p.kg).toFixed(1)).join('')+'" fill="none" stroke="#45D6C4" stroke-width="2.2" stroke-linejoin="round"/>';
    pts.forEach(p => { g += '<circle cx="'+X(p.date).toFixed(1)+'" cy="'+Y(p.kg).toFixed(1)+'" r="2.6" fill="var(--text-dim)"/><circle class="hit" cx="'+X(p.date).toFixed(1)+'" cy="'+Y(p.kg).toFixed(1)+'" r="9" fill="transparent" data-tip="'+esc(shortDay(p.date)+': '+fmtKg(p.kg)+' kg')+'"/>'; });
    g += '<text x="'+pad.l+'" y="'+(H-6)+'">'+shortDay(pts[0].date)+'</text><text x="'+(W-pad.r)+'" y="'+(H-6)+'" text-anchor="end">'+shortDay(pts[pts.length-1].date)+'</text>';
    chart = '<div class="pf-legend"><span><i style="background:var(--text-dim)"></i>Weigh-ins</span><span><i style="background:#45D6C4"></i>Trend</span></div><svg class="pf-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Body weight over time">'+g+'</svg>';
  } else chart = '<div class="empty-note">'+(pts.length ? 'Log another weigh-in to see your trend.' : 'Log your weight now and then. It keeps your W/kg and starting weights up to date.')+'</div>';
  const last = log.length ? log[log.length-1].kg : '';
  return chart + '<form class="sp-wform" id="spWeightForm"><label for="spWeight">Today</label><input type="number" id="spWeight" min="25" max="300" step="0.1" inputmode="decimal" placeholder="kg" value="'+last+'"><button class="primary" type="submit">Log weight</button><span class="sp-wmsg" id="spWeightMsg" role="status"></span></form>';
}

// el: container; data: { history, log, onLogWeight(kg) -> Promise<new log> }
export function renderStrength(el, data){
  const today = todayIso();
  let { history, log } = data;
  const sets = flatSets(history);
  function draw(){
    const W = Math.max(300, Math.round(el.clientWidth - 38));
    const half = W >= 760 ? Math.round((W - 16) / 2) : W;
    el.innerHTML = '<p class="hub-sub">Your lifting from TrainerStrength: how much, how balanced, and whether it\'s moving.</p>'
      + tilesHtml(sets, history, log, today)
      + '<div class="panel"><div class="panel-title"><span>Hard sets each week</span></div><div class="pf-sub">Sets stopped with 3 or fewer reps left, by muscle group</div>'+weeklyHtml(sets, today, W)+'</div>'
      + '<div class="pf-two">'
      + '<div class="panel"><div class="panel-title"><span>Your lifts</span></div><div class="pf-sub">Best set each session, last 6 months</div>'+liftsHtml(history, today)+'</div>'
      + '<div class="panel"><div class="panel-title"><span>Body weight</span></div>'+weightHtml(log, today, half)+'</div>'
      + '</div><div class="pf-tip" role="status"></div>';
    el.querySelector('#spWeightForm').addEventListener('submit', async e => {
      e.preventDefault();
      const kg = parseFloat(el.querySelector('#spWeight').value), msg = el.querySelector('#spWeightMsg');
      if (!(kg >= 25 && kg <= 300)){ msg.textContent = 'Enter your weight in kg.'; return; }
      msg.textContent = 'Saving…';
      try { log = await data.onLogWeight(kg); draw(); el.querySelector('#spWeightMsg').textContent = 'Logged.'; }
      catch(_){ msg.textContent = 'Couldn\'t save. Check your connection and try again.'; }
    });
  }
  draw();
  el.onpointermove = e => {
    const tip = el.querySelector('.pf-tip'); const t = e.target.closest('[data-tip]');
    if (!tip) return;
    if (!t){ tip.style.display = 'none'; return; }
    tip.textContent = t.dataset.tip; tip.style.display = 'block';
    const box = el.getBoundingClientRect();
    tip.style.left = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, e.clientX - box.left + 14)) + 'px';
    tip.style.top = (e.clientY - box.top + 14) + 'px';
  };
  el.onpointerleave = () => { const tip = el.querySelector('.pf-tip'); if (tip) tip.style.display = 'none'; };
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (el.isConnected && el.offsetParent) draw(); }, 150); });
}

export const STRENGTH_PROGRESS_CSS = `
  .sp-note{ margin-top:10px; font-size:13px; line-height:1.45; color:var(--text); background:var(--panel-2); border:1px solid var(--line); border-radius:8px; padding:8px 11px; }
  .sp-lifts{ display:grid; gap:2px; }
  .sp-lift{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 0; border-top:1px solid var(--line); }
  .sp-lift:first-child{ border-top:0; padding-top:0; }
  .sp-ln{ display:flex; flex-direction:column; gap:1px; min-width:0; font-size:12.5px; color:var(--text-dim); }
  .sp-ln b{ font-size:14px; color:var(--text); font-weight:600; }
  .sp-ln .up{ color:var(--accent); } .sp-ln .down{ color:#F5A66A; }
  .sp-spark{ flex-shrink:0; }
  .sp-wform{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:12px; font-size:13px; }
  .sp-wform label{ color:var(--text-dim); }
  .sp-wform input{ width:96px; margin:0; padding:8px 10px; background:var(--panel-2); color:var(--text); border:1px solid var(--line); border-radius:8px; font:inherit; font-family:var(--mono); }
  .sp-wform input:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  .sp-wform button{ width:auto; margin:0; padding:9px 16px; }
  .sp-wmsg{ font-size:12.5px; color:var(--text-dim); }
`;
