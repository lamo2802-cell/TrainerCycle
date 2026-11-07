// Running pace curve and critical speed (like intervals.icu's pace curve). From best efforts within
// runs (completed_rides.run_bests: { "<metres>": seconds }).
// Critical speed model: distance = CS x time + D', fitted to the best 1K to 10K efforts. CS is the
// fastest pace you can keep up for a long time (roughly 30 to 40 minutes of running); D' is the
// distance you can cover above it before tiring.

const CS_DISTS = [1000, 1609, 5000, 10000];

export function fitCs(best){
  const pts = CS_DISTS.filter(d => best[d] > 0).map(d => ({ d, t: best[d] }));
  if (pts.length < 3 || pts[pts.length-1].d < 5000) return null;
  const mt = pts.reduce((a,p)=>a+p.t,0)/pts.length, md = pts.reduce((a,p)=>a+p.d,0)/pts.length;
  let num = 0, den = 0;
  for (const p of pts){ num += (p.t-mt)*(p.d-md); den += (p.t-mt)*(p.t-mt); }
  const cs = den ? num/den : 0, dPrime = md - cs*mt;
  // a believable fit: 2 to 7 m/s, D' between 50 and 500 m
  if (!(cs > 2 && cs < 7 && dPrime >= 50 && dPrime <= 500)) return null;
  return { cs, dPrime: Math.round(dPrime), csPace: Math.round(1000 / cs), thresholdPace: Math.round(1000 / cs) };
}
// Model pace (s/km) for a distance, from about 1 km up.
export const modelPace = (d, cs, dPrime) => d > dPrime ? 1000 * ((d - dPrime) / cs) / d : null;

export function bestTimes(runs, sinceIso){
  const out = {};
  (runs || []).forEach(r => {
    if (!r.run_bests || (sinceIso && r.started_at < sinceIso)) return;
    Object.entries(r.run_bests).forEach(([m, t]) => { const v = Number(t); if (v > 0 && (!out[m] || v < out[m])) out[m] = v; });
  });
  return out;
}

// SVG pace curve: x = distance (log), y = pace with faster higher. all/recent: { "<m>": seconds }.
export function paceCurveSvg({ all, recent, fit, width, dists, labels, fmtPace }){
  const pts = m => dists.filter(d => m[d]).map(d => ({ d, p: m[d] / (d / 1000) }));
  const a = pts(all), b = pts(recent || {});
  if (a.length < 2) return '';
  const W = Math.max(280, Math.round(width || 600)), H = W < 500 ? 170 : 200, pad = { l:46, r:24, t:10, b:22 };
  const used = a.map(q => q.d);
  const d0 = Math.min(...used), d1 = Math.max(...used);
  const model = fit ? [] : null;
  if (fit) for (let k = 0; k <= 40; k++){ const d = Math.max(1000, d0) * Math.pow(d1 / Math.max(1000, d0), k / 40); const p = modelPace(d, fit.cs, fit.dPrime); if (p) model.push({ d, p }); }
  const all_p = a.concat(b, model || []).map(q => q.p);
  let lo = Math.floor(Math.min(...all_p) / 15) * 15, hi = Math.ceil(Math.max(...all_p) / 15) * 15;
  if (hi - lo < 60) hi = lo + 60;
  const lx = Math.log, x0 = lx(d0), x1 = lx(d1) === x0 ? x0 + 1 : lx(d1);
  const X = d => pad.l + (lx(d) - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = p => pad.t + (p - lo) / (hi - lo) * (H - pad.t - pad.b);
  const step = (hi - lo) > 180 ? 60 : 30;
  let g = '';
  for (let p = lo; p <= hi; p += step) g += '<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+Y(p).toFixed(1)+'" y2="'+Y(p).toFixed(1)+'" stroke="#2A323D"/><text x="'+(pad.l-6)+'" y="'+(Y(p)+4).toFixed(1)+'" text-anchor="end">'+fmtPace(p)+'</text>';
  used.forEach(d => { g += '<text x="'+X(d).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle">'+(labels[d] || '')+'</text>'; });
  const line = (p, col, dash, w) => p.length < 2 ? '' : '<polyline fill="none" stroke="'+col+'" stroke-width="'+(w || 2.2)+'" stroke-linejoin="round"'+(dash ? ' stroke-dasharray="'+dash+'"' : '')+' points="'+p.map(q=>X(q.d).toFixed(1)+','+Y(q.p).toFixed(1)).join(' ')+'"/>';
  const dots = a.map(q => '<circle cx="'+X(q.d).toFixed(1)+'" cy="'+Y(q.p).toFixed(1)+'" r="3" fill="#d95926" stroke="#171D25" stroke-width="2"/>').join('');
  return '<svg class="rec-curve" viewBox="0 0 '+W+' '+H+'" style="font:11px var(--mono); fill:#8C97A6;">'+g+(model ? line(model, '#A78BFA', '2 3', 1.6) : '')+line(b, 'rgba(232,185,61,.85)', '5 4')+line(a, '#d95926')+dots+'</svg>';
}
