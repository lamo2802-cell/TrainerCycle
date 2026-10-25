// Small motion helpers shared by app pages.

// Numbers marked data-count="123" count up from 0 the first time they're shown.
// Keeps any text around the number (e.g. "+12") by only animating the value itself.
export function countUp(root = document, ms = 700){
  const els = root.querySelectorAll('[data-count]');
  if (!els.length) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  const items = [...els].map(el => {
    const to = Number(el.dataset.count);
    const dec = (String(el.dataset.count).split('.')[1] || '').length;
    const prefix = el.dataset.prefix || '';
    el.removeAttribute('data-count');
    return { el, to, dec, prefix, text: el.textContent };
  }).filter(x => isFinite(x.to) && x.to !== 0);
  function frame(now){
    const t = Math.min(1, (now - start) / ms);
    const e = 1 - Math.pow(1 - t, 3); // ease out
    for (const it of items){
      it.el.textContent = t < 1 ? it.prefix + (it.to * e).toFixed(it.dec) : it.text;
    }
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Personal bests: for each duration, did this ride beat every earlier ride?
// rides: [{ id, started_at, power_bests }]. Returns [{ d, w, prev }] for the durations it set a new best.
export const PB_DURS = [5, 60, 300, 1200, 3600];
export function newBests(ride, rides){
  if (!ride || !ride.power_bests) return [];
  const before = rides.filter(r => r.id !== ride.id && r.power_bests && r.started_at < ride.started_at);
  if (!before.length) return []; // the first ride sets everything; that's not news
  const out = [];
  for (const d of PB_DURS){
    const w = Number(ride.power_bests[d]);
    if (!w) continue;
    const prev = Math.max(0, ...before.map(r => Number(r.power_bests[d]) || 0));
    if (prev && w > prev) out.push({ d, w, prev });
  }
  return out;
}
export function pbLabel(d){ return d < 60 ? d+' s' : d < 3600 ? (d/60)+' min' : (d/3600)+' h'; }

// Weeks in a row (Mon-Sun) with at least one ride, counting this week only if it already has one.
// Returns { weeks, since } where since is the Monday the streak began.
export function weekStreak(rides, now = new Date()){
  const monday = d => { const m = new Date(d); m.setHours(0,0,0,0); m.setDate(m.getDate() - ((m.getDay()+6)%7)); return m.getTime(); };
  const weeks = new Set(rides.map(r => monday(new Date(r.started_at))));
  let wk = monday(now), n = 0, since = null;
  if (!weeks.has(wk)) wk = monday(new Date(wk - 3*86400000));
  while (weeks.has(wk)){ n++; since = new Date(wk); wk = monday(new Date(wk - 3*86400000)); }
  return { weeks: n, since };
}
