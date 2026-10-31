// Stacked activity charts, one per data stream (power, heart rate, pace or speed, cadence, elevation),
// sharing one time axis and one crosshair, like Garmin Connect and Strava. Drag (or hover) across any
// chart and every chart shows its value at that moment; the line above reads the time and distance.
// Used by the ride (Live Ride samples, Strava streams) and run (Strava or Garmin trace) detail views.
//
// stackHtml({ dt, n, dist?, channels }) where each channel is
//   { label, color, vals (n values, null = no data), fmt(v) -> text, unit?, min?, area?, avg?,
//     win? (points either side averaged for the readout), summary? (html when not scrubbing),
//     readFmt?(v, i) (html for the value under the crosshair), smooth? (drawn points averaged either side),
//     bands? ([{ i0, i1, v, fill }] drawn behind the line, e.g. workout targets), noAvgLine? }
// Channels with no data are left out.

let seq = 0;
const STACKS = new Map();   // stack id -> { n, dt, dist, channels }
const W = 1000, H = 100;

function fmtClock(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}
// Average of each of M equal slices, so a two-hour ride draws as a few hundred points.
function bucket(vals, n, M){
  const out = new Array(M);
  for (let b = 0; b < M; b++){
    const i0 = Math.floor(b * n / M), i1 = Math.max(i0 + 1, Math.floor((b + 1) * n / M));
    let t = 0, c = 0;
    for (let i = i0; i < i1; i++){ const v = vals[i]; if (v != null && isFinite(v)){ t += v; c++; } }
    out[b] = c ? t / c : null;
  }
  return out;
}
// Centred moving average of the drawn points (k either side), for noisy streams like GPS pace.
function smooth(a, k){ return a.map((v, i) => v == null ? null : windowAvg(a, i, k)); }
function windowAvg(vals, i, k){
  let t = 0, c = 0;
  for (let j = Math.max(0, i - k); j <= Math.min(vals.length - 1, i + k); j++){ const v = vals[j]; if (v != null) { t += v; c++; } }
  return c ? t / c : null;
}
const has = c => c && c.vals && c.vals.some(v => v != null && (c.signed || v > 0));

export function stackHtml({ dt, n, dist, channels, hint }){
  channels = (channels || []).filter(has);
  if (!channels.length || n < 2) return '';
  const id = 'ac' + (++seq), M = Math.min(n, 480), total = n * dt;
  const xb = b => ((b + 0.5) / M * W).toFixed(1);
  const rows = channels.map(c => {
    const b = c.smooth ? smooth(bucket(c.vals, n, M), c.smooth) : bucket(c.vals, n, M);
    const vs = b.filter(v => v != null).sort((p, q) => p - q);
    let lo = c.min != null ? c.min : vs[Math.floor(vs.length * 0.02)];
    let hi = vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.998))];
    if (c.bands) hi = Math.max(hi, ...c.bands.map(x => x.v));
    if (hi - lo < (c.minSpan || 1)) { const mid = (hi + lo) / 2, h = (c.minSpan || 1) / 2; lo = c.min != null ? c.min : mid - h; hi = Math.max(mid + h, lo + 2 * h); }
    const padV = (hi - lo) * 0.08; hi += padV; if (c.min == null) lo -= padV * 0.5;
    const y = v => H - 3 - Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * (H - 10);
    // Break the line where there's no data rather than drawing across the gap.
    const segs = []; let seg = [];
    b.forEach((v, i) => { if (v == null){ if (seg.length) segs.push(seg); seg = []; } else seg.push([xb(i), y(v).toFixed(1)]); });
    if (seg.length) segs.push(seg);
    const line = segs.map(s => '<polyline points="' + s.map(p => p.join(',')).join(' ') + '" class="ac-line" style="stroke:' + c.color + '" vector-effect="non-scaling-stroke"/>').join('');
    const area = c.area === false ? '' : segs.map(s => '<polygon points="' + s[0][0] + ',' + H + ' ' + s.map(p => p.join(',')).join(' ') + ' ' + s[s.length - 1][0] + ',' + H + '" style="fill:' + c.color + '" class="ac-area"/>').join('');
    const bands = (c.bands || []).map(x => '<rect x="' + (x.i0 / n * W).toFixed(1) + '" width="' + (Math.max(1, (x.i1 - x.i0) / n * W)).toFixed(1) + '" y="' + y(x.v).toFixed(1) + '" height="' + (H - y(x.v)).toFixed(1) + '" style="fill:' + x.fill + '"/>').join('');
    const all = c.vals.filter(v => v != null && (c.zeros ? true : v > 0));
    const avg = c.avg != null ? c.avg : all.length ? all.reduce((p, q) => p + q, 0) / all.length : null;
    const max = all.length ? Math.max(...all) : null;
    const avgLine = avg != null && !c.noAvgLine ? '<line x1="0" x2="' + W + '" y1="' + y(avg).toFixed(1) + '" y2="' + y(avg).toFixed(1) + '" class="ac-avg" vector-effect="non-scaling-stroke"/>' : '';
    const summary = c.summary != null ? c.summary : (avg != null ? 'Avg <b>' + c.fmt(avg) + '</b>' : '') + (max != null ? ' · Max <b>' + c.fmt(max) + '</b>' : '');
    c._lo = lo; c._hi = hi; c._summary = summary;
    return '<div class="ac-row">'
      + '<div class="ac-head"><span class="ac-name"><i style="background:' + c.color + '"></i>' + c.label + (c.unit ? ' <span class="ac-unit">' + c.unit + '</span>' : '') + '</span><span class="ac-val" data-ac-val>' + summary + '</span></div>'
      + '<div class="ac-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + bands + area + avgLine + line + '</svg>'
      + '<span class="ac-tick t">' + c.fmt(hi - padV) + '</span><span class="ac-tick b">' + c.fmt(c.min != null ? lo : lo + padV * 0.5) + '</span>'
      + '<div class="ac-cur" data-ac-cur hidden></div><div class="ac-dot" data-ac-dot hidden style="background:' + c.color + '"></div></div></div>';
  });
  STACKS.set(id, { n, dt, dist, channels });
  const labs = [0, 0.25, 0.5, 0.75, 1].map((f, k) => '<span' + (k % 2 ? ' class="ac-mid"' : '') + '>' + fmtClock(total * f) + '</span>').join('');
  return '<div class="ac-read" data-ac-read>' + (hint || 'Drag across the charts to see every reading at that moment.') + '</div>'
    + '<div class="ac-stack" data-ac="' + id + '">' + rows.join('') + '<div class="ac-xlab">' + labs + '</div></div>';
}

function readout(st, i){
  const bits = ['<b>' + fmtClock((i + 0.5) * st.dt) + '</b>'];
  if (st.dist && st.dist[i] != null) bits.push((st.dist[i] / 1000).toFixed(2) + ' km');
  return bits.join(' · ');
}
function show(el, f){
  const st = STACKS.get(el.dataset.ac); if (!st) return;
  const i = Math.max(0, Math.min(st.n - 1, Math.floor(f * st.n)));
  const rows = el.querySelectorAll('.ac-row');
  st.channels.forEach((c, k) => {
    const row = rows[k]; if (!row) return;
    const v = windowAvg(c.vals, i, c.win || 0);
    const val = row.querySelector('[data-ac-val]'), cur = row.querySelector('[data-ac-cur]'), dot = row.querySelector('[data-ac-dot]');
    cur.style.left = (f * 100).toFixed(2) + '%'; cur.hidden = false;
    if (v == null){ val.innerHTML = '<span class="ac-none">—</span>'; dot.hidden = true; return; }
    val.innerHTML = c.readFmt ? c.readFmt(v, i) : '<b>' + c.fmt(v) + '</b>' + (c.unit ? ' ' + c.unit : '');
    const yf = Math.max(0, Math.min(1, (v - c._lo) / (c._hi - c._lo)));
    dot.style.left = (f * 100).toFixed(2) + '%'; dot.style.top = ((H - 3 - yf * (H - 10)) / H * 100).toFixed(1) + '%'; dot.hidden = false;
  });
  const read = el.previousElementSibling;
  if (read && read.hasAttribute('data-ac-read')){ read.innerHTML = readout(st, i); read.classList.add('on'); }
}
function reset(el){
  const st = STACKS.get(el.dataset.ac); if (!st) return;
  el.querySelectorAll('.ac-row').forEach((row, k) => {
    const c = st.channels[k]; if (!c) return;
    row.querySelector('[data-ac-val]').innerHTML = c._summary;
    row.querySelector('[data-ac-cur]').hidden = true; row.querySelector('[data-ac-dot]').hidden = true;
  });
  const read = el.previousElementSibling;
  if (read && read.hasAttribute('data-ac-read')){ read.textContent = 'Drag across the charts to see every reading at that moment.'; read.classList.remove('on'); }
}

// Wire once on a container that the charts are rendered into (any number of times).
export function wireCharts(root){
  const at = e => {
    const el = e.target.closest && e.target.closest('[data-ac]'); if (!el) return;
    const plot = el.querySelector('.ac-plot'); if (!plot) return;
    const box = plot.getBoundingClientRect();
    show(el, Math.max(0, Math.min(0.9999, (e.clientX - box.left) / box.width)));
  };
  root.addEventListener('pointermove', at);
  root.addEventListener('pointerdown', at);
  // A mouse leaving puts the averages back; on touch the last reading stays until the next tap.
  root.addEventListener('pointerout', e => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest && e.target.closest('[data-ac]');
    if (el && !el.contains(e.relatedTarget)) reset(el);
  });
}

// Runs of equal target values (e.g. workout steps), for channel.bands.
export function bandsFrom(vals, fill){
  const out = []; let cur = null;
  vals.forEach((v, i) => {
    if (cur && v === cur.v){ cur.i1 = i + 1; return; }
    if (cur && cur.v) out.push(cur);
    cur = { i0: i, i1: i + 1, v };
  });
  if (cur && cur.v) out.push(cur);
  return out.map(b => Object.assign(b, { fill: fill(b.v) }));
}
export { fmtClock };

export const CHARTS_CSS = `
  .ac-read{ font:12.5px var(--mono); color:var(--text-dim); min-height:20px; margin-bottom:6px; }
  .ac-read.on{ color:var(--text); } .ac-read b{ font-weight:600; }
  .ac-stack{ position:relative; touch-action:pan-y; cursor:crosshair; user-select:none; -webkit-user-select:none; }
  .ac-row{ margin-bottom:10px; }
  .ac-head{ display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:12.5px; margin-bottom:4px; }
  .ac-name{ display:flex; align-items:center; gap:7px; color:var(--text); font-weight:600; white-space:nowrap; }
  .ac-name i{ display:inline-block; width:10px; height:10px; border-radius:3px; }
  .ac-unit{ color:var(--text-dim); font-weight:400; font-size:11.5px; }
  .ac-val{ font:12px var(--mono); color:var(--text-dim); text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ac-val b{ color:var(--text); font-weight:600; }
  .ac-none{ opacity:.6; }
  .ac-plot{ position:relative; height:78px; }
  @media (min-width:700px){ .ac-plot{ height:96px; } }
  .ac-plot svg{ width:100%; height:100%; display:block; background:var(--panel-2); border-radius:6px; }
  .ac-line{ fill:none; stroke-width:1.5; stroke-linejoin:round; }
  .ac-area{ opacity:.16; stroke:none; }
  .ac-avg{ stroke:rgba(231,236,242,.35); stroke-dasharray:4 4; stroke-width:1; }
  .ac-tick{ position:absolute; left:6px; font:10.5px var(--mono); color:var(--text-dim); pointer-events:none; background:rgba(29,36,45,.75); padding:0 3px; border-radius:3px; }
  .ac-tick.t{ top:3px; } .ac-tick.b{ bottom:3px; }
  .ac-cur{ position:absolute; top:0; bottom:0; width:0; border-left:1px solid var(--text); opacity:.75; pointer-events:none; }
  .ac-dot{ position:absolute; width:9px; height:9px; margin:-4.5px 0 0 -4.5px; border-radius:50%; border:2px solid var(--panel); pointer-events:none; }
  .ac-cur[hidden], .ac-dot[hidden]{ display:none; }
  .ac-xlab{ display:flex; justify-content:space-between; font:11px var(--mono); color:var(--text-dim); margin-top:-4px; }
  @media (max-width:520px){ .ac-xlab .ac-mid{ display:none; } }
`;
