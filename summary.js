// A few plain lines at the top of a ride or run: what the session did, how it went, and what to do
// next. Written from the numbers we already have (zones, intervals, efficiency, comparisons, bests),
// so it's always right about the facts. "Next" only shows for a session in the last day and a half.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const mins = sec => Math.round(sec / 60);
const RECENT = 36 * 3600000;

// zoneSec: seconds in each power zone (Recovery, Endurance, Tempo, Threshold, VO2 Max, Anaerobic, Sprint).
function rideDid({ zoneSec, durationSec }){
  if (!zoneSec) return null;
  const [rec, end, tempo, thr, ...high] = zoneSec;
  const hi = high.reduce((a, b) => a + b, 0), total = zoneSec.reduce((a, b) => a + b, 0) || durationSec || 1;
  if (hi >= 480) return { hard: true, text: 'VO2 max work: ' + mins(hi) + ' min above 106% of FTP. This raises the ceiling on your fitness.' };
  if (thr >= 900) return { hard: thr >= 1200, text: 'Threshold work: ' + mins(thr) + ' min at 91–106% of FTP. This lifts the power you can hold for an hour.' };
  // An endurance ride that drifts over 76% now and then is still an endurance ride.
  if ((end + rec) / total >= 0.6) return { easy: (rec + end) / total >= 0.85, text: 'Aerobic base: ' + mins(end + rec) + ' min at Endurance or easier. This builds the engine everything else sits on.' };
  if (tempo + thr >= 1200) return { text: 'Tempo and sweet spot: ' + mins(tempo + thr) + ' min at 76–106% of FTP. Solid work for holding power for longer.' };
  return { text: mins(total) + ' min of mixed riding.' };
}

// pace: runZones(...).pace bands; workout: analyseRun(...).workout.
function runDid({ pace, workout, intensity }){
  if (workout){
    const repSec = workout.reps.reduce((a, r) => a + r.e, 0);
    return { hard: true, text: 'Intervals: ' + workout.label + ', ' + mins(repSec) + ' min of hard running in all. This builds speed and your top-end fitness.' };
  }
  if (pace){
    const sec = k => pace.filter(b => k.includes(b.key)).reduce((a, b) => a + b.sec, 0), total = pace.reduce((a, b) => a + b.sec, 0) || 1;
    const easy = sec(['recovery', 'easy']), quick = sec(['threshold', 'interval', 'fast']);
    if (quick >= 900) return { hard: true, text: 'Threshold running: ' + mins(quick) + ' min at threshold pace or quicker. This lifts the pace you can hold for an hour.' };
    if (easy / total >= 0.8) return { easy: true, text: 'Easy running: ' + mins(easy) + ' min at Easy pace. This builds your aerobic base with little fatigue.' };
    if (sec(['steady']) / total >= 0.3) return { text: 'A steady run: ' + mins(sec(['steady'])) + ' min at Steady pace, around marathon effort. Good for endurance, but it tires you more than easy running.' };
    return { text: 'A mixed run, mostly at Easy and Steady pace.' };
  }
  if (intensity != null) return intensity >= 0.9 ? { hard: true, text: 'A hard run, near your threshold pace.' } : intensity < 0.8 ? { easy: true, text: 'An easy run.' } : { text: 'A steady run.' };
  return null;
}

// The one most worth saying about how it went, in order: a best, beating last time, decoupling,
// efficiency against usual.
function howItWent({ bests, compare, eff, usualDiff, completed, workout }){
  if (completed === false) return 'You stopped this one early. Every minute still counts towards your Fitness.';
  if (bests && bests.length) return 'New best: ' + bests.join(', ') + '.';
  if (compare) return compare;
  if (workout && workout.reps.length >= 3){
    const pace = r => r.e / r.d, first = pace(workout.reps[0]), last = pace(workout.reps[workout.reps.length - 1]), d = (last - first) / first;
    if (d <= -0.015) return 'You got quicker through the reps, finishing ' + Math.round(-d * 100) + '% faster than you started. Well paced.';
    if (d < 0.03) return 'Your reps were even from first to last. Well paced.';
    return 'Your reps faded ' + Math.round(d * 100) + '% from first to last. Start the first one or two a little easier next time.';
  }
  if (eff && eff.decoupling != null){
    if (eff.decoupling < 5) return 'Your heart rate held steady all the way (' + eff.decoupling.toFixed(1) + '% decoupling), so your aerobic fitness handled this comfortably.';
    return 'Your heart rate drifted ' + eff.decoupling.toFixed(1) + '% against your effort in the second half, so this was near the edge of what your aerobic base holds.';
  }
  if (usualDiff != null && Math.abs(usualDiff) >= 0.05) return 'Efficiency was ' + Math.round(Math.abs(usualDiff) * 100) + '% ' + (usualDiff > 0 ? 'better' : 'lower') + ' than usual' + (usualDiff > 0 ? '.' : ': tiredness, heat or a late night can all do this.');
  return null;
}

function whatNext({ did, tss, intensity }){
  if (!did) return null;
  if (did.hard || (tss || 0) >= 100 || (intensity || 0) >= 0.9) return 'Keep tomorrow easy or take a rest day, so this one sinks in.';
  if (did.easy) return 'You\'re fresh enough for a quality session tomorrow if one\'s due.';
  return 'A normal day tomorrow is fine.';
}

// facts: { kind:'ride'|'run', startedAt, durationSec, tss, intensity, completed, zoneSec | pace + workout,
//          eff, usualDiff, bests:[labels], compare: 'text' | null }
export function summaryHtml(facts, { now = Date.now(), nextHref } = {}){
  const did = facts.kind === 'run' ? runDid(facts) : rideDid(facts);
  if (!did) return '';
  const how = howItWent(facts);
  const recent = now - new Date(facts.startedAt).getTime() < RECENT;
  const next = recent ? whatNext({ did, tss: facts.tss, intensity: facts.intensity }) : null;
  const line = (k, t, extra = '') => '<div class="sm-line"><span class="sm-k">' + k + '</span><span class="sm-t">' + esc(t) + extra + '</span></div>';
  return '<div class="panel sm-panel">'
    + line('What it did', did.text)
    + (how ? line('How it went', how) : '')
    + (next ? line('Next', next, nextHref ? ' <a href="' + nextHref + '">See what we\'d do</a>' : '') : '')
    + '</div>';
}

export const SUMMARY_CSS = `
  .sm-panel{ display:grid; gap:10px; }
  .sm-line{ display:grid; grid-template-columns:110px minmax(0,1fr); gap:12px; align-items:baseline; font-size:14px; }
  .sm-k{ font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--text-dim); }
  .sm-t a{ color:var(--accent); white-space:nowrap; }
  @media (max-width:520px){ .sm-line{ grid-template-columns:1fr; gap:2px; } }
`;
