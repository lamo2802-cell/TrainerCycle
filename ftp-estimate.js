// FTP detection from ride data. Each saved ride stores its best average power over a few key
// durations (completed_rides.power_bests, e.g. {"300":285,"1200":262}). From the last six weeks of
// those we estimate FTP three ways and take the strongest:
//   - 95% of the best 20 minutes (the classic test)
//   - the best 60 minutes
//   - 96% of critical power, fitted to the best 3 to 20 minute efforts (a 2-parameter CP model)
// Rides in ERG mode mostly hold the targets, so this only fires when you've genuinely gone
// harder than your FTP says you can: a free ride, a raised intensity, a hard outdoor-style effort.

export const BEST_DURS = [5, 60, 180, 300, 480, 720, 1200, 1800, 3600];
const CP_DURS = [180, 300, 480, 720, 1200];
export const FTP_LOOKBACK_DAYS = 42;
export const FTP_MIN_GAIN = 0.03; // only suggest a change of 3% or more

// samples: [{ elapsed, power, ... }] at roughly 1 Hz. Returns { "<sec>": watts } for each duration ridden.
export function powerBests(samples){
  if (!Array.isArray(samples) || !samples.length) return null;
  const n = Math.floor(Number(samples[samples.length-1].elapsed) || 0) + 1;
  if (n < 5) return null;
  const sum = new Float64Array(n), cnt = new Uint16Array(n);
  for (const s of samples){
    const t = Math.floor(Number(s.elapsed));
    const p = Number(s.power);
    if (t >= 0 && t < n && isFinite(p) && p >= 0){ sum[t] += p; cnt[t]++; }
  }
  // one value per second, carrying the last reading over gaps (as the ride page does)
  const pre = new Float64Array(n + 1);
  let last = 0;
  for (let t = 0; t < n; t++){ if (cnt[t]) last = sum[t]/cnt[t]; pre[t+1] = pre[t] + last; }
  const out = {};
  for (const d of BEST_DURS){
    if (d > n) break;
    let best = 0;
    for (let i = d; i <= n; i++){ const a = (pre[i] - pre[i-d]) / d; if (a > best) best = a; }
    if (best > 0) out[d] = Math.round(best);
  }
  return Object.keys(out).length ? out : null;
}

// rides: [{ id, started_at, power_bests }], newest or oldest first. Returns null, or
// { ftp, basis, rideId, date } describing the strongest estimate in the lookback window.
export function estimateFtp(rides, now = new Date()){
  const since = new Date(now.getTime() - FTP_LOOKBACK_DAYS*86400000);
  const best = {}; // dur -> { w, rideId, date }
  for (const r of rides || []){
    if (!r.power_bests || new Date(r.started_at) < since) continue;
    for (const [k, w] of Object.entries(r.power_bests)){
      const d = Number(k);
      if (!best[d] || w > best[d].w) best[d] = { w:Number(w), rideId:r.id, date:r.started_at };
    }
  }
  const cands = [];
  if (best[1200]) cands.push({ ftp: best[1200].w * 0.95, basis: '95% of your best 20 minutes ('+best[1200].w+' W)', rideId: best[1200].rideId, date: best[1200].date });
  if (best[3600]) cands.push({ ftp: best[3600].w, basis: 'your best hour ('+best[3600].w+' W)', rideId: best[3600].rideId, date: best[3600].date });
  const pts = CP_DURS.filter(d => best[d]).map(d => ({ t:d, work: best[d].w * d, ...best[d] }));
  if (pts.length >= 3 && pts[pts.length-1].t >= 720){
    // least squares on work = CP * t + W'
    const mt = pts.reduce((a,p)=>a+p.t,0)/pts.length, mw = pts.reduce((a,p)=>a+p.work,0)/pts.length;
    let num = 0, den = 0;
    for (const p of pts){ num += (p.t-mt)*(p.work-mw); den += (p.t-mt)*(p.t-mt); }
    const cp = den ? num/den : 0, wPrime = mw - cp*mt;
    // only trust a fit that looks like real maximal efforts (a sensible W' and CP below the 3-min best)
    if (cp > 0 && wPrime >= 4000 && wPrime <= 40000 && cp < pts[0].w){
      const latest = pts.reduce((a,p)=> p.date > a.date ? p : a, pts[0]);
      // FTP sits a little under CP for most riders
      cands.push({ ftp: cp * 0.96, basis: 'your best 3 to 20 minute efforts', rideId: latest.rideId, date: latest.date });
    }
  }
  if (!cands.length) return null;
  const top = cands.reduce((a,c)=> c.ftp > a.ftp ? c : a);
  return { ...top, ftp: Math.round(top.ftp) };
}

// Should we offer `est` over the current FTP? `dismissed` is the estimate the rider last said no to.
export function shouldSuggest(est, currentFtp, dismissed){
  if (!est || !currentFtp) return false;
  if (est.ftp < currentFtp * (1 + FTP_MIN_GAIN)) return false;
  if (dismissed && est.ftp <= dismissed) return false;
  return true;
}
