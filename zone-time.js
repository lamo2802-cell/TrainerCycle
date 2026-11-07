// Real time in zone by week (like intervals.icu), in three bands that work across sports:
//   Easy (below ~80% FTP / 88% of threshold pace), Moderate (up to threshold), Hard (above threshold).
// Each session's seconds come from the best source it has:
//   - indoor workouts: the workout's steps (ERG holds the targets), cut to the time actually ridden
//   - Strava/Garmin rides and runs with a saved trace: power vs FTP, or grade-adjusted pace vs threshold pace
//   - anything else: the whole session in one band by its intensity (IF)
import { gradeFactor } from './run-analysis.js?v=4';

export const BANDS3 = [
  { key:'easy', label:'Easy', color:'#4C8BF5', note:'below about 80% of FTP or easy run pace' },
  { key:'mod',  label:'Moderate', color:'#E8B93D', note:'tempo, sweet spot and threshold' },
  { key:'hard', label:'Hard', color:'#E5484D', note:'above threshold: VO2 max, anaerobic, sprints' },
];
const RIDE_EDGES = [0.80, 1.00], RUN_EDGES = [0.88, 1.00];
const bandOf = (ratio, edges) => ratio < edges[0] ? 0 : ratio <= edges[1] ? 1 : 2;

function flat(steps){ let out = []; for (const st of steps || []){ if (st.type === 'repeat'){ for (let i = 0; i < st.repetitions; i++) out = out.concat(flat(st.steps)); } else out.push(st); } return out; }
function stepPct(st, ftp){
  if (st.targetType === 'watts') return ftp ? (st.low + st.high) / 2 / ftp * 100 : null;
  if (st.targetType === 'hr_pct' || st.targetType === 'hr_bpm') return null;
  return (Number(st.low) + Number(st.high)) / 2;
}
function ifOf(r){
  if (r.intensity_factor != null) return Number(r.intensity_factor);
  if (r.tss != null && r.duration_sec > 0) return Math.sqrt(r.tss / (r.duration_sec / 3600) / 100);
  return null;
}

// One session: { z:[easy, mod, hard] seconds, src:'steps'|'trace'|'session' } or null (strength, no data).
export function sessionZones(r, { workout, detail, ftp, runPace } = {}){
  if (!r || r.sport === 'strength' || !(r.duration_sec > 0)) return null;
  const z = [0, 0, 0];
  const sport = r.sport || 'ride';
  const rideFtp = r.np && r.intensity_factor ? r.np / r.intensity_factor : ftp;
  // indoor workout steps
  if (sport === 'ride' && workout && workout.steps && (!r.source || r.source === 'trainercycle')){
    let left = r.duration_sec, ok = true;
    for (const st of flat(workout.steps)){
      if (left <= 0) break;
      const pct = stepPct(st, rideFtp); if (pct == null){ ok = false; break; }
      const d = Math.min(left, Number(st.duration) || 0);
      z[bandOf(pct / 100, RIDE_EDGES)] += d; left -= d;
    }
    if (ok){ if (left > 0) z[0] += left; return { z, src:'steps' }; }
    z.fill(0);
  }
  // saved trace
  const s = detail && detail.s;
  if (s && s.v && s.v.length){
    const dt = s.dt || 5;
    if (sport === 'ride' && s.p && rideFtp){
      s.p.forEach(p => { const w = Number(p); if (w > 0) z[bandOf(w / rideFtp, RIDE_EDGES)] += dt; else z[0] += dt; });
      return { z, src:'trace' };
    }
    if (sport === 'run' && runPace){
      const thr = 1000 / runPace; // m/s
      s.v.forEach((v, i) => { const ms = Number(v) / 100; if (!(ms > 0.5)) return; z[bandOf(ms * gradeFactor(s.g && s.g[i]) / thr, RUN_EDGES)] += dt; });
      if (z.some(x => x)) return { z, src:'trace' };
    }
  }
  const IF = ifOf(r);
  if (IF == null) return null;
  z[bandOf(IF, sport === 'run' ? [0.86, 1.0] : [0.80, 1.0])] = r.duration_sec;
  return { z, src:'session' };
}

// How the time splits, in words (Seiler's polarised / pyramidal / threshold models).
export function distribution(z){
  const t = z[0] + z[1] + z[2]; if (!t) return null;
  const e = z[0] / t, m = z[1] / t, h = z[2] / t;
  if (e >= 0.9) return { key:'easy', label:'Almost all easy', note:'Great for base, but a little hard work each week would lift your top end.' };
  if (e >= 0.72 && h > m) return { key:'polarised', label:'Polarised', note:'Mostly easy with some hard sessions and little in between. A proven mix for building fitness.' };
  if (e >= 0.6 && m >= h) return { key:'pyramidal', label:'Pyramidal', note:'Mostly easy, then less moderate, then a little hard. A solid, sustainable mix.' };
  if (m >= 0.35) return { key:'threshold', label:'Threshold-heavy', note:'Lots of time in the moderate middle. Making easy days easier lets the hard days count more.' };
  if (h >= 0.25) return { key:'intense', label:'Intensity-heavy', note:'A lot of hard riding. Watch for fatigue and keep some days properly easy.' };
  return { key:'mixed', label:'Mixed', note:'A spread across all three bands.' };
}
