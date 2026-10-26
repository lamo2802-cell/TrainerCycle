// Progress → Performance: how training is trending. Built from completed_rides rows (no samples) and
// the planned sessions from fitness.js loadPlanned(). Charts are inline SVG with one hover tooltip.
import { todayIso, addDays, isoDate, parseIso } from './plan-schedule.js?v=5';
import { fmtPace } from './run.js?v=5';
import { fmtSwimPace } from './swim.js?v=2';

// Sport colours for charts: validated for colour-blind separation on the panel colour (#171D25).
// (The app's sport dots elsewhere are brighter; these are stepped for charts.)
const SPORTS = [
  { id:'ride', label:'Ride', color:'#3987e5' },
  { id:'run', label:'Run', color:'#d95926' },
  { id:'swim', label:'Swim', color:'#199e70' },
  { id:'strength', label:'Strength', color:'#c98500' },
];
const BANDS = [
  { label:'Recovery', max:0.55, color:'var(--z-recovery)' },
  { label:'Endurance', max:0.75, color:'var(--z-endurance)' },
  { label:'Tempo', max:0.88, color:'var(--z-tempo)' },
  { label:'Sweet spot & threshold', max:1.05, color:'var(--z-threshold)' },
  { label:'Above threshold', max:9, color:'var(--z-vo2)' },
];

const esc = s => String(s ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sportOf = r => r.sport || 'ride';
const dayOf = r => isoDate(new Date(r.started_at));
const fmtHrs = sec => { const m = Math.round(sec/60); return m >= 60 ? Math.floor(m/60)+'h'+(m%60 ? String(m%60).padStart(2,'0') : '') : m+'m'; };
const mondayOf = iso => addDays(iso, -((parseIso(iso).getDay()+6)%7));
const shortDay = iso => parseIso(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
const monthLabel = key => new Date(Number(key.slice(0,4)), Number(key.slice(5,7))-1, 1).toLocaleDateString('en-GB', { month:'short' });
const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

// ---- tiles: last 4 weeks against the 4 before ----
function tilesHtml(acts, today){
  const a0 = addDays(today, -27), b0 = addDays(today, -55);
  const cur = acts.filter(r => dayOf(r) >= a0), prev = acts.filter(r => dayOf(r) >= b0 && dayOf(r) < a0);
  const sum = (l, f) => l.reduce((t, r) => t + (f(r) || 0), 0);
  const tile = (label, now, before, fmt) => {
    const d = before ? Math.round((now - before) / before * 100) : null;
    return '<div class="pf-tile"><div class="lbl">'+label+'</div><div class="val">'+fmt(now)+'</div>'
      + '<div class="note">'+(d == null ? 'last 4 weeks' : (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '')+Math.abs(d)+'% on the 4 before')+'</div></div>';
  };
  return '<div class="pf-tiles">'
    + tile('Time', sum(cur, r => r.duration_sec), sum(prev, r => r.duration_sec), fmtHrs)
    + tile('TSS', sum(cur, r => r.tss), sum(prev, r => r.tss), v => Math.round(v))
    + tile('Sessions', cur.length, prev.length, v => v)
    + tile('Distance', sum(cur, r => r.sport === 'swim' ? 0 : r.distance_m), sum(prev, r => r.sport === 'swim' ? 0 : r.distance_m), v => Math.round(v/1000)+' km')
    + '</div>';
}

// ---- weekly volume by sport (stacked columns) ----
function weeklyHtml(acts, today, W, metric){
  const weeks = [];
  const mon = mondayOf(today);
  for (let i = 11; i >= 0; i--) weeks.push({ mon: addDays(mon, -7*i), by:{} });
  acts.forEach(r => { const w = weeks.find(x => dayOf(r) >= x.mon && dayOf(r) <= addDays(x.mon, 6)); if (!w) return;
    const s = sportOf(r); w.by[s] = (w.by[s] || 0) + (metric === 'tss' ? (r.tss || 0) : (r.duration_sec || 0) / 3600); });
  const used = SPORTS.filter(s => weeks.some(w => w.by[s.id]));
  const max = niceMax(Math.max(0.1, ...weeks.map(w => Object.values(w.by).reduce((a, b) => a + b, 0))));
  const H = 200, pad = { l:36, r:8, t:10, b:22 };
  const slot = (W - pad.l - pad.r) / weeks.length, bw = Math.min(24, slot * 0.62);
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  let g = '';
  for (let i = 0; i <= 4; i++){ const v = max * i / 4, yy = y(v).toFixed(1);
    g += '<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--line)"/><text x="'+(pad.l-6)+'" y="'+(Number(yy)+4)+'" text-anchor="end">'+(metric === 'tss' ? Math.round(v) : (Math.round(v*10)/10)+'h')+'</text>'; }
  weeks.forEach((w, i) => {
    const cx = pad.l + slot * (i + .5);
    let base = 0;
    const segs = used.filter(s => w.by[s.id]);
    const total = segs.reduce((a, s) => a + w.by[s.id], 0);
    const tip = shortDay(w.mon)+' week: '+(metric === 'tss' ? Math.round(total)+' TSS' : fmtHrs(total*3600))
      + (segs.length ? '\n'+segs.map(s => s.label+' '+(metric === 'tss' ? Math.round(w.by[s.id]) : fmtHrs(w.by[s.id]*3600))).join('\n') : '');
    segs.forEach((s, k) => {
      const y1 = y(base + w.by[s.id]), y0 = y(base);
      const h = Math.max(0, y0 - y1 - (k ? 2 : 0)); // 2px surface gap between segments
      const top = k === segs.length - 1;
      g += top ? '<path d="'+roundTop(cx - bw/2, y1, bw, h)+'" fill="'+s.color+'"/>' : '<rect x="'+(cx-bw/2).toFixed(1)+'" y="'+y1.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" fill="'+s.color+'"/>';
      base += w.by[s.id];
    });
    g += '<rect class="hit" x="'+(cx-slot/2).toFixed(1)+'" y="'+pad.t+'" width="'+slot.toFixed(1)+'" height="'+(H-pad.t-pad.b)+'" fill="transparent" data-tip="'+esc(tip)+'"/>';
    if ((weeks.length - 1 - i) % Math.ceil(48 / slot) === 0) g += '<text x="'+cx.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+shortDay(w.mon)+'</text>';
  });
  const legend = used.length > 1 ? '<div class="pf-legend">'+used.map(s => '<span><i style="background:'+s.color+'"></i>'+s.label+'</span>').join('')+'</div>' : '';
  return legend + '<svg class="pf-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Weekly training '+(metric === 'tss' ? 'TSS' : 'hours')+' by sport, last 12 weeks">'+g+'</svg>';
}
function roundTop(x, y, w, h){
  const r = Math.min(4, w/2, h);
  return 'M'+x.toFixed(1)+','+(y+h).toFixed(1)+'V'+(y+r).toFixed(1)+'Q'+x.toFixed(1)+','+y.toFixed(1)+' '+(x+r).toFixed(1)+','+y.toFixed(1)
    + 'H'+(x+w-r).toFixed(1)+'Q'+(x+w).toFixed(1)+','+y.toFixed(1)+' '+(x+w).toFixed(1)+','+(y+r).toFixed(1)+'V'+(y+h).toFixed(1)+'Z';
}

// ---- a single-series monthly line (power, pace) ----
function monthKeys(today, n){ const out = []; const d = parseIso(today); for (let i = n-1; i >= 0; i--){ const m = new Date(d.getFullYear(), d.getMonth()-i, 1); out.push(m.getFullYear()+'-'+String(m.getMonth()+1).padStart(2,'0')); } return out; }
function lineHtml({ W, points, fmt, invert = false, ref = null, refLabel = '', color = '#45D6C4', label }){
  const H = 190, pad = { l:46, r:12, t:12, b:22 };
  const vals = points.filter(p => p.v != null).map(p => p.v).concat(ref ? [ref] : []);
  if (points.filter(p => p.v != null).length < 2) return '';
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 4); lo -= span * .15; hi += span * .15;
  // round gridlines: the smallest step that gives at most four bands
  const step = [1,2,5,10,15,20,25,30,50,60,100,200].find(s => (Math.ceil(hi/s) - Math.floor(lo/s)) <= 4) || 500;
  lo = Math.floor(lo/step)*step; hi = Math.ceil(hi/step)*step;
  const x = i => pad.l + (W - pad.l - pad.r) * i / (points.length - 1);
  const y = v => pad.t + (H - pad.t - pad.b) * (invert ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo));
  let g = '';
  for (let v = lo; v <= hi; v += step){ const yy = y(v).toFixed(1);
    g += '<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--line)"/><text x="'+(pad.l-6)+'" y="'+(Number(yy)+4)+'" text-anchor="end">'+fmt(v)+'</text>'; }
  if (ref){ const yy = y(ref).toFixed(1); g += '<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--text-dim)" stroke-dasharray="4 4"/><text x="'+(W-pad.r)+'" y="'+(Number(yy)-5)+'" text-anchor="end" class="ref">'+esc(refLabel)+'</text>'; }
  let d = '', open = false;
  points.forEach((p, i) => { if (p.v == null){ open = false; return; } d += (open ? 'L' : 'M') + x(i).toFixed(1)+','+y(p.v).toFixed(1); open = true; });
  g += '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  points.forEach((p, i) => {
    g += '<text x="'+x(i).toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+(points.length > 8 && i % 2 !== (points.length-1) % 2 ? '' : monthLabel(p.key))+'</text>';
    if (p.v == null) return;
    g += '<circle cx="'+x(i).toFixed(1)+'" cy="'+y(p.v).toFixed(1)+'" r="4" fill="'+color+'" stroke="var(--panel)" stroke-width="2"/>'
      + '<rect class="hit" x="'+(x(i)-14).toFixed(1)+'" y="'+pad.t+'" width="28" height="'+(H-pad.t-pad.b)+'" fill="transparent" data-tip="'+esc(monthLabel(p.key)+': '+p.tip)+'"/>';
  });
  return '<svg class="pf-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(label)+'">'+g+'</svg>';
}

function powerHtml(acts, today, W, ftp){
  const keys = monthKeys(today, 12);
  const best = {};
  acts.forEach(r => { const b = r.power_bests && Number(r.power_bests[1200]); if (!b) return; const k = dayOf(r).slice(0,7); if (!best[k] || b > best[k].w) best[k] = { w:b, r }; });
  const points = keys.map(k => ({ key:k, v: best[k] ? Math.round(best[k].w * 0.95) : null, tip: best[k] ? 'best 20 min '+best[k].w+' W, so FTP about '+Math.round(best[k].w*0.95)+' W' : '' }));
  const svg = lineHtml({ W, points, fmt: v => Math.round(v)+' W', ref: ftp, refLabel: ftp ? 'Your FTP '+Math.round(ftp)+' W' : '', label:'Estimated FTP by month' });
  return svg || '<div class="empty-note">Ride with a power meter in at least two months and your FTP trend shows here.</div>';
}
function paceHtml(acts, today, W, sport){
  const keys = monthKeys(today, 12);
  const per = sport === 'run' ? 1000 : 100;
  const by = {};
  acts.filter(r => r.sport === sport && r.distance_m > 0 && r.duration_sec > 0).forEach(r => { const k = dayOf(r).slice(0,7); const b = by[k] = by[k] || { t:0, m:0, n:0 }; b.t += r.duration_sec; b.m += r.distance_m; b.n++; });
  const f = sport === 'run' ? fmtPace : fmtSwimPace;
  const points = keys.map(k => { const b = by[k]; const v = b ? b.t / (b.m / per) : null; return { key:k, v, tip: b ? f(v)+(sport === 'run' ? ' /km' : ' /100 m')+' average over '+b.n+' '+(sport === 'run' ? 'run' : 'swim')+(b.n === 1 ? '' : 's') : '' }; });
  return lineHtml({ W, points, fmt: v => f(v), invert:true, color: sport === 'run' ? '#d95926' : '#199e70', label:'Average '+sport+' pace by month' });
}

// ---- intensity mix: time in each band by each session's intensity ----
function mixHtml(acts, today, days){
  const from = addDays(today, -(days-1));
  const secs = BANDS.map(() => 0);
  acts.filter(r => dayOf(r) >= from && r.intensity_factor != null && r.sport !== 'strength').forEach(r => {
    const i = BANDS.findIndex(b => Number(r.intensity_factor) < b.max); secs[i < 0 ? BANDS.length-1 : i] += r.duration_sec || 0; });
  const total = secs.reduce((a, b) => a + b, 0);
  if (!total) return '<div class="empty-note">No sessions with an intensity in this time.</div>';
  return '<div class="pf-mix">'+BANDS.map((b, i) => '<div class="row" data-tip="'+esc(b.label+': '+fmtHrs(secs[i])+' ('+Math.round(secs[i]/total*100)+'%)')+'"><span class="nm"><i style="background:'+b.color+'"></i>'+b.label+'</span>'
    + '<span class="track"><i style="width:'+(secs[i]/total*100).toFixed(1)+'%; background:'+b.color+'"></i></span><b>'+Math.round(secs[i]/total*100)+'%</b><span class="h">'+fmtHrs(secs[i])+'</span></div>').join('')+'</div>';
}

// ---- did the planned sessions get done ----
function adherenceHtml(planned, today, W){
  const mon = mondayOf(today);
  const weeks = [];
  for (let i = 7; i >= 0; i--){ const m = addDays(mon, -7*i); weeks.push({ mon:m, list: planned.filter(s => s.date >= m && s.date <= addDays(m, 6) && s.date <= today && s.sport !== 'race') }); }
  const all = weeks.flatMap(w => w.list);
  if (!all.length) return '<div class="empty-note">Follow a plan or plan workouts on the calendar and you\'ll see how many you did here.</div>';
  const done = all.filter(s => s.done).length;
  const max = Math.max(1, ...weeks.map(w => w.list.length));
  const H = 170, pad = { l:28, r:8, t:10, b:22 };
  const slot = (W - pad.l - pad.r) / weeks.length, bw = Math.min(24, slot * .62);
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  let g = '';
  for (let v = 0; v <= max; v += Math.max(1, Math.ceil(max/4))){ const yy = y(v).toFixed(1); g += '<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--line)"/><text x="'+(pad.l-6)+'" y="'+(Number(yy)+4)+'" text-anchor="end">'+v+'</text>'; }
  weeks.forEach((w, i) => {
    const cx = pad.l + slot*(i+.5), n = w.list.length, d = w.list.filter(s => s.done).length;
    if (n){
      g += '<path d="'+roundTop(cx-bw/2, y(n), bw, y(0)-y(n))+'" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-dasharray="3 3"/>';
      if (d) g += '<path d="'+roundTop(cx-bw/2, y(d), bw, y(0)-y(d))+'" fill="#45D6C4"/>';
    }
    g += '<rect class="hit" x="'+(cx-slot/2).toFixed(1)+'" y="'+pad.t+'" width="'+slot.toFixed(1)+'" height="'+(H-pad.t-pad.b)+'" fill="transparent" data-tip="'+esc(shortDay(w.mon)+' week: '+(n ? d+' of '+n+' planned sessions done' : 'nothing planned'))+'"/>';
    if ((weeks.length - 1 - i) % Math.ceil(48 / slot) === 0) g += '<text x="'+cx.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+shortDay(w.mon)+'</text>';
  });
  return '<div class="pf-legend"><span><i style="background:#45D6C4"></i>Done</span><span><i class="dash"></i>Planned</span><span class="pf-big">'+Math.round(done/all.length*100)+'% done over 8 weeks ('+done+' of '+all.length+')</span></div>'
    + '<svg class="pf-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Planned sessions done each week, last 8 weeks">'+g+'</svg>';
}

// el: container; acts: completed_rides rows for the last year or so; planned: loadPlanned(); ftp: current FTP.
export function renderPerformance(el, { acts, planned, ftp }){
  const today = todayIso();
  let metric = 'hours', mixDays = 28;
  function draw(){
    const W = Math.max(300, Math.round(el.clientWidth - 38));
    const half = W >= 760 ? Math.round((W - 16) / 2) : W;
    const swims = acts.some(r => r.sport === 'swim' && r.distance_m);
    el.innerHTML = tilesHtml(acts, today)
      + '<div class="panel"><div class="panel-title"><span>Weekly training</span><div class="seg pf-seg" data-seg="metric"><button data-v="hours"'+(metric === 'hours' ? ' class="on"' : '')+'>Hours</button><button data-v="tss"'+(metric === 'tss' ? ' class="on"' : '')+'>TSS</button></div></div>'+weeklyHtml(acts, today, W, metric)+'</div>'
      + '<div class="pf-two">'
      + '<div class="panel"><div class="panel-title"><span>Estimated FTP by month</span></div><div class="pf-sub">95% of your best 20 minutes each month</div>'+powerHtml(acts, today, half, ftp)+'</div>'
      + '<div class="panel"><div class="panel-title"><span>Intensity mix</span><div class="seg pf-seg" data-seg="mix"><button data-v="28"'+(mixDays === 28 ? ' class="on"' : '')+'>4 wks</button><button data-v="84"'+(mixDays === 84 ? ' class="on"' : '')+'>12 wks</button></div></div><div class="pf-sub">Time by each session\'s average intensity (IF)</div>'+mixHtml(acts, today, mixDays)+'</div>'
      + '</div><div class="pf-two">'
      + '<div class="panel"><div class="panel-title"><span>Run pace by month</span></div><div class="pf-sub">Average pace of runs with a distance</div>'+(paceHtml(acts, today, half, 'run') || '<div class="empty-note">Runs with a distance in at least two months show a trend here.</div>')+'</div>'
      + (swims ? '<div class="panel"><div class="panel-title"><span>Swim pace by month</span></div><div class="pf-sub">Average pace per 100 m</div>'+(paceHtml(acts, today, half, 'swim') || '<div class="empty-note">Swims in at least two months show a trend here.</div>')+'</div>'
        : '<div class="panel"><div class="panel-title"><span>Planned sessions done</span></div>'+adherenceHtml(planned, today, half)+'</div>')
      + '</div>'
      + (swims ? '<div class="panel"><div class="panel-title"><span>Planned sessions done</span></div>'+adherenceHtml(planned, today, W)+'</div>' : '')
      + '<div class="pf-tip" role="status"></div>';
  }
  draw();
  el.onclick = e => {
    const b = e.target.closest('.pf-seg [data-v]'); if (!b) return;
    if (b.closest('[data-seg]').dataset.seg === 'metric') metric = b.dataset.v; else mixDays = Number(b.dataset.v);
    draw();
  };
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
  const onResize = () => { clearTimeout(t); t = setTimeout(() => { if (el.isConnected && el.offsetParent) draw(); }, 150); };
  window.addEventListener('resize', onResize);
}

export const PERFORMANCE_CSS = `
  .pf-tiles{ display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; margin-bottom:14px; }
  .pf-tile{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .pf-tile .lbl{ font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:.05em; }
  .pf-tile .val{ font-family:var(--mono); font-size:24px; font-weight:600; margin-top:2px; }
  .pf-tile .note{ font-size:12px; color:var(--text-dim); }
  @media (max-width:600px){ .pf-tiles{ grid-template-columns:repeat(2, minmax(0,1fr)); } .pf-tile .val{ font-size:20px; } }
  .pf-two{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .pf-two > .panel{ min-width:0; }
  @media (max-width:899px){ .pf-two{ grid-template-columns:1fr; gap:0; } }
  .pf-sub{ font-size:12px; color:var(--text-dim); margin:-6px 0 10px; }
  .pf-svg{ width:100%; height:auto; display:block; font:11px var(--mono); fill:var(--text-dim); overflow:visible; }
  .pf-svg text.ref{ fill:var(--text-dim); }
  .pf-legend{ display:flex; flex-wrap:wrap; gap:14px; font-size:12px; color:var(--text-dim); margin-bottom:8px; align-items:center; }
  .pf-legend span{ display:flex; align-items:center; gap:6px; }
  .pf-legend i{ width:10px; height:10px; border-radius:3px; display:inline-block; }
  .pf-legend i.dash{ border:1.5px dashed var(--text-dim); width:8px; height:8px; }
  .pf-legend .pf-big{ margin-left:auto; color:var(--text); font-weight:600; }
  .pf-seg button{ padding:4px 10px; font-size:12px; text-transform:none; letter-spacing:0; }
  .pf-mix{ display:grid; gap:9px; }
  .pf-mix .row{ display:grid; grid-template-columns:minmax(0,180px) 1fr 42px 50px; align-items:center; gap:10px; font-size:13px; }
  .pf-mix .nm{ display:flex; align-items:center; gap:7px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pf-mix .nm i{ width:9px; height:9px; border-radius:3px; flex-shrink:0; }
  .pf-mix .track{ height:8px; background:var(--panel-2); border-radius:4px; overflow:hidden; }
  .pf-mix .track i{ display:block; height:100%; border-radius:4px; }
  .pf-mix b{ font-family:var(--mono); text-align:right; }
  .pf-mix .h{ font-family:var(--mono); color:var(--text-dim); font-size:12px; text-align:right; }
  @media (max-width:600px){ .pf-mix .row{ grid-template-columns:minmax(0,1fr) 70px 38px; } .pf-mix .h{ display:none; } }
  #hubView{ position:relative; }
  .pf-tip{ position:absolute; display:none; pointer-events:none; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:12px; white-space:pre-line; font-family:var(--mono); z-index:5; max-width:260px; }
`;
