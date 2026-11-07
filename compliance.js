// How closely a done session matched what was planned (like intervals.icu's compliance colours).
// Compares training load (TSS) when both sides have one, otherwise time.
export function matchScore(planned, ride){
  if (!planned || !ride) return null;
  let pct = null;
  if (planned.tss > 0 && ride.tss != null) pct = ride.tss / planned.tss;
  else if (planned.durationSec > 0 && ride.duration_sec > 0) pct = ride.duration_sec / planned.durationSec;
  if (pct == null) return null;
  const p = Math.round(pct * 100);
  const tone = p >= 80 && p <= 120 ? 'good' : p >= 50 && p <= 150 ? 'near' : 'off';
  const label = tone === 'good' ? 'On plan' : p < 100 ? 'Short of plan' : 'Over plan';
  return { pct: p, tone, label };
}

// Share of the planned load done for the sessions due so far (each session counts up to its plan).
// sessions: [{ tss, durationSec, doneRide, date }] due on or before today.
export function weekMatch(sessions){
  let want = 0, got = 0;
  sessions.forEach(s => {
    const useTss = s.tss > 0;
    const plan = useTss ? s.tss : (s.durationSec || 0);
    if (!plan) return;
    want += plan;
    if (s.doneRide){ const v = useTss ? (s.doneRide.tss != null ? s.doneRide.tss : plan * (s.doneRide.duration_sec || 0) / (s.durationSec || 1)) : (s.doneRide.duration_sec || 0); got += Math.min(plan, v); }
  });
  return want ? Math.round(got / want * 100) : null;
}

export const TONE_COLOURS = { good:'#2fb36d', near:'#e8b93d', off:'#e0564a' };
