// Power profile (like intervals.icu): critical power (CP), W' and max power fitted to your best
// efforts, an eFTP from them, a rider type from the shape of the curve, and W' balance (how much
// of the "anaerobic tank" above CP is left at each moment of a ride).
//
// CP model: work = CP x t + W', fitted to the best 3 to 20 minute efforts (as ftp-estimate.js).
// W' balance: above CP it drains by (P - CP) each second; below CP it refills in proportion to how
// empty it is (the Froncioni/Clarke differential form).

const CP_DURS = [180, 300, 480, 720, 1200];
export const DEFAULT_W_PRIME = 20000;   // J, a typical value until your own efforts give one

// rides: [{ started_at, power_bests }]. Best watts for each stored duration since sinceIso (all if null).
export function bestPowers(rides, sinceIso){
  const out = {};
  (rides || []).forEach(r => {
    if (!r.power_bests || (sinceIso && r.started_at < sinceIso)) return;
    Object.entries(r.power_bests).forEach(([k, w]) => { const v = Number(w); if (v > 0 && (!out[k] || v > out[k])) out[k] = v; });
  });
  return out;
}

// best: { "<sec>": watts }. Returns { cp, wPrime, pmax, eftp } or null when the efforts don't fit
// like real maximal ones.
export function fitCp(best){
  const pts = CP_DURS.filter(d => best[d] > 0).map(d => ({ t:d, work: best[d] * d, w: best[d] }));
  if (pts.length < 3 || pts[pts.length-1].t < 720) return null;
  const mt = pts.reduce((a,p)=>a+p.t,0)/pts.length, mw = pts.reduce((a,p)=>a+p.work,0)/pts.length;
  let num = 0, den = 0;
  for (const p of pts){ num += (p.t-mt)*(p.work-mw); den += (p.t-mt)*(p.t-mt); }
  const cp = den ? num/den : 0, wPrime = mw - cp*mt;
  if (!(cp > 0 && wPrime >= 4000 && wPrime <= 40000 && cp < pts[0].w)) return null;
  // eFTP: the strongest of 96% of CP, 95% of the best 20 min and the best hour, as ftp-estimate.js
  const eftp = Math.max(cp * 0.96, (best[1200] || 0) * 0.95, best[3600] || 0);
  return { cp: Math.round(cp), wPrime: Math.round(wPrime), pmax: best[5] || null, eftp: Math.round(eftp) };
}

// What the model says you could hold for t seconds (only meaningful from about 2 minutes up).
export const modelPower = (t, cp, wPrime) => cp + wPrime / t;

// Rider type from how your short bests compare with CP. Ratios for a typical trained rider are
// about 5 s: 3.5x CP, 1 min: 1.6x, 5 min: 1.2x.
export function riderType(best, cp){
  if (!cp) return null;
  const r5 = best[5] ? best[5] / cp : null, r60 = best[60] ? best[60] / cp : null, r300 = best[300] ? best[300] / cp : null;
  if (r5 == null || r300 == null) return null;
  if (r5 >= 4.3 && (r60 == null || r60 >= 1.7)) return { key:'sprinter', name:'Sprinter', note:'Your short punches stand out. Long steady efforts are where there\'s most to gain.' };
  if (r300 >= 1.28 || (r60 != null && r60 >= 1.85)) return { key:'puncher', name:'Puncher', note:'Strong for 1 to 5 minutes: climbs, attacks and short hard reps. Threshold work will lift the rest.' };
  if (r5 < 3.1 && r300 < 1.15) return { key:'tt', name:'Time triallist', note:'You hold steady power well. Some sprint and VO2 work would round you out.' };
  return { key:'allrounder', name:'All-rounder', note:'No big gaps: short, medium and long efforts are all in proportion.' };
}

// Profile for a window of days. ftp is the fallback when no fit is possible.
export function powerProfile(rides, { days = 90, now = new Date(), ftp = null } = {}){
  const since = days ? new Date(now.getTime() - days*86400000).toISOString() : null;
  const best = bestPowers(rides, since);
  const fit = fitCp(best);
  if (fit) return Object.assign({ fitted:true, best, type: riderType(best, fit.cp) }, fit);
  if (!ftp) return null;
  return { fitted:false, best, cp: Math.round(ftp / 0.96), wPrime: DEFAULT_W_PRIME, pmax: best[5] || null, eftp: null, type: null };
}

// power: watts per sample, dt seconds apart. Returns W' balance in joules per sample.
export function wBalance(power, dt, cp, wPrime){
  const out = new Array(power.length);
  let w = wPrime;
  for (let i = 0; i < power.length; i++){
    const p = Number(power[i]) || 0;
    if (p > cp) w -= (p - cp) * dt;
    else w += (cp - p) * dt * (w < wPrime ? (wPrime - w) / wPrime : 0);
    w = Math.max(0, Math.min(wPrime, w));
    out[i] = w;
  }
  return out;
}

// Efforts that dug into W' ("matches burned"): stretches above CP (gaps under 30 s joined) that used
// at least 15% of W'. Returns [{ i0, i1, used, low }] with low = lowest balance in J.
export function matches(power, dt, cp, wPrime, wb){
  const out = []; let cur = null, gap = 0;
  for (let i = 0; i < power.length; i++){
    const above = (Number(power[i]) || 0) > cp;
    if (above){
      if (!cur) cur = { i0:i, i1:i, start: i ? wb[i-1] : wPrime, low: wb[i] };
      cur.i1 = i; cur.low = Math.min(cur.low, wb[i]); gap = 0;
    } else if (cur){
      gap += dt;
      if (gap > 30){ cur.used = cur.start - cur.low; if (cur.used >= wPrime * 0.15) out.push(cur); cur = null; gap = 0; }
    }
  }
  if (cur){ cur.used = cur.start - cur.low; if (cur.used >= wPrime * 0.15) out.push(cur); }
  return out;
}
