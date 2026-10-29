// Full-screen "you did it" moment shown when a session is saved, before the summary page.
// A drawn tick, the session's headline numbers, any new power bests and the training streak.
// Motion is CSS transforms and opacity only (cheap on old tablets) and is skipped for reduced motion.
import { countUp, newBests, pbLabel, weekStreak } from './motion.js?v=1';

const CSS = `
.fin{ position:fixed; inset:0; z-index:500; display:flex; align-items:center; justify-content:center; overflow-y:auto;
  padding:max(24px, env(safe-area-inset-top, 0px)) 20px max(24px, env(safe-area-inset-bottom, 0px));
  background:radial-gradient(ellipse 70% 55% at 50% 32%, rgba(69,214,196,.11), transparent 70%), var(--bg, #10141A);
  color:var(--text, #E7ECF2); animation:finFade .35s ease-out both; }
.fin-card{ position:relative; z-index:1; width:100%; max-width:600px; text-align:center; margin:auto; }
.fin-mark{ display:block; overflow:visible; width:76px; height:76px; margin:0 auto 20px; }
.fin-ring, .fin-tick{ fill:none; stroke:var(--accent, #45D6C4); stroke-linecap:round; stroke-linejoin:round; }
.fin-ring{ stroke-width:2.5; stroke-dasharray:183; stroke-dashoffset:183; transform:rotate(-90deg); transform-origin:32px 32px; animation:finDraw .75s .1s cubic-bezier(.65,0,.35,1) forwards; }
.fin-tick{ stroke-width:3.5; stroke-dasharray:36; stroke-dashoffset:36; animation:finDraw .35s .75s ease-out forwards; }
.fin-halo{ fill:var(--accent, #45D6C4); opacity:0; transform-origin:32px 32px; animation:finHalo 1.1s .85s ease-out; }
.fin-rise{ opacity:0; animation:finRise .5s ease-out forwards; }
.fin-kicker{ font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--accent, #45D6C4); animation-delay:.55s; }
.fin-title{ font-size:clamp(26px, 6vw, 40px); font-weight:700; letter-spacing:-.02em; line-height:1.15; margin:8px 0 6px; animation-delay:.65s; overflow-wrap:anywhere; }
.fin-line{ font-size:14.5px; color:var(--text-dim, #8C97A6); margin:0 0 26px; animation-delay:.75s; }
.fin-stats{ display:grid; border-top:1px solid var(--line, #2A323D); border-bottom:1px solid var(--line, #2A323D); padding:18px 0; margin-bottom:22px; animation-delay:.85s; }
.fin-stat + .fin-stat{ border-left:1px solid var(--line, #2A323D); }
.fin-stat b{ display:block; font-family:var(--mono, ui-monospace, monospace); font-size:clamp(26px, 5.5vw, 38px); font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
.fin-stat span{ display:block; margin-top:4px; font-size:11px; color:var(--text-dim, #8C97A6); text-transform:uppercase; letter-spacing:.07em; }
.fin-pbs{ display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-bottom:16px; animation-delay:1.05s; }
.fin-pb{ display:inline-flex; align-items:center; gap:7px; padding:7px 13px; border-radius:999px; font-size:13.5px;
  border:1px solid rgba(232,185,61,.42); background:rgba(232,185,61,.08); color:#F1CF74; }
.fin-pb svg{ width:14px; height:14px; fill:currentColor; flex-shrink:0; }
.fin-pb s{ color:var(--text-dim, #8C97A6); text-decoration:none; font-size:12px; }
.fin-notes{ display:flex; flex-wrap:wrap; justify-content:center; gap:6px 18px; font-size:13.5px; color:var(--text-dim, #8C97A6); margin-bottom:28px; animation-delay:1.15s; }
.fin-notes span{ display:inline-flex; align-items:center; gap:6px; }
.fin-notes b{ color:var(--text, #E7ECF2); font-weight:600; }
.fin-notes svg{ width:16px; height:16px; flex-shrink:0; }
.fin-go{ width:auto !important; min-width:240px; margin:0 auto !important; padding:14px 34px !important; font-size:16px !important; font-weight:600; animation-delay:1.25s; }
.fin-confetti{ position:fixed; inset:0; overflow:hidden; pointer-events:none; z-index:0; }
.fin-confetti i{ position:absolute; top:-16px; width:6px; height:11px; border-radius:1.5px; opacity:0; will-change:transform;
  animation:finFall var(--t) var(--dl) cubic-bezier(.25,.6,.45,1) forwards; }
@keyframes finFade{ from{ opacity:0; } to{ opacity:1; } }
@keyframes finDraw{ to{ stroke-dashoffset:0; } }
@keyframes finHalo{ 0%{ opacity:.22; transform:scale(.7); } 100%{ opacity:0; transform:scale(1.5); } }
@keyframes finRise{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:none; } }
@keyframes finFall{
  0%{ opacity:0; transform:translate3d(0, 0, 0) rotate(0deg); }
  8%{ opacity:.85; }
  80%{ opacity:.7; }
  100%{ opacity:0; transform:translate3d(var(--dx), 92vh, 0) rotate(var(--r)); } }
@media (max-width:520px){
  .fin-stats{ grid-template-columns:repeat(2, minmax(0, 1fr)) !important; row-gap:16px; }
  .fin-stat:nth-child(odd){ border-left:0; }
  .fin-stats[style*="--n:3"] .fin-stat:last-child{ grid-column:1 / -1; border-left:0; }
}
@media (max-height:560px) and (orientation:landscape){
  .fin-mark{ width:46px; height:46px; margin-bottom:10px; }
  .fin-title{ font-size:26px; margin:4px 0; }
  .fin-stat b{ font-size:28px; }
  .fin-line{ margin-bottom:14px; }
  .fin-stats{ padding:12px 0; margin-bottom:14px; }
  .fin-notes{ margin-bottom:16px; }
}
/* Big screens and TVs: scale with the height so it reads from the bike. */
@media (min-width:1500px) and (min-height:901px){
  .fin-card{ max-width:min(1100px, 70vw); }
  .fin-mark{ width:11vh; height:11vh; margin-bottom:3vh; }
  .fin-kicker{ font-size:1.7vh; }
  .fin-title{ font-size:5.2vh; }
  .fin-line{ font-size:2.1vh; margin-bottom:4vh; }
  .fin-stats{ padding:3vh 0; margin-bottom:3.4vh; }
  .fin-stat b{ font-size:6.4vh; }
  .fin-stat span{ font-size:1.6vh; }
  .fin-pb, .fin-notes{ font-size:2vh; }
  .fin-pb svg, .fin-notes svg{ width:2.2vh; height:2.2vh; }
  .fin-notes{ margin-bottom:4.5vh; }
  .fin-go{ font-size:2.2vh !important; padding:1.8vh 5vh !important; }
}
@media (prefers-reduced-motion:reduce){
  .fin, .fin-rise, .fin-ring, .fin-tick, .fin-halo{ animation:none !important; opacity:1; stroke-dashoffset:0; }
  .fin-halo{ opacity:0; }
  .fin-confetti{ display:none; }
}`;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';
const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:#F08A3C"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.3 1.6 1.2 2.6 2.3 2.8C11 8.6 11.2 5.6 12 3z"/></svg>';
const WEEK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
const PLAN = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="var(--accent, #45D6C4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CONFETTI = ['#45D6C4', '#4C8BF5', '#E8B93D', '#E7ECF2', '#3DBE7A'];

function fmtTime(sec){
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function mondayOf(d){ const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }

// What goes on the screen, worked out from the saved session and the rider's earlier ones.
// ride: the completed_rides record just saved. history: earlier completed_rides rows (all sports).
export function finishFacts(ride, history = [], now = new Date()){
  const all = history.filter(r => r.id !== ride.id).concat([ride]);
  const kj = ride.avg_power != null ? Math.round(ride.avg_power * ride.duration_sec / 1000) : null;
  const stats = [{ v: fmtTime(ride.duration_sec), l: 'Time' }];
  if (ride.tss != null) stats.push({ v: ride.tss, l: 'TSS', count: true });
  if (ride.np != null) stats.push({ v: ride.np, l: 'NP (W)', count: true });
  else if (ride.avg_power != null) stats.push({ v: ride.avg_power, l: 'Avg W', count: true });
  if (kj) stats.push({ v: kj, l: 'kJ', count: true });
  const week = mondayOf(now).getTime();
  const thisWeek = all.filter(r => new Date(r.started_at).getTime() >= week);
  return {
    stats,
    pbs: newBests(ride, all),
    streak: weekStreak(all, now).weeks,
    weekCount: thisWeek.length,
    weekTss: Math.round(thisWeek.reduce((a, r) => a + (Number(r.tss) || 0), 0)),
    plan: !!ride.plan_id
  };
}

// Shows the screen and resolves when the rider moves on.
// opts: { kicker, title, line, button, confetti }
export function showFinish(ride, history, opts = {}){
  if (!document.getElementById('finCss')){ const st = document.createElement('style'); st.id = 'finCss'; st.textContent = CSS; document.head.appendChild(st); }
  const f = finishFacts(ride, history);
  const notes = [];
  if (f.plan) notes.push('<span>' + PLAN + 'Plan session done</span>');
  if (f.streak >= 2) notes.push('<span>' + FLAME + '<b>' + f.streak + '-week streak</b></span>');
  if (f.weekCount >= 2) notes.push('<span>' + WEEK + '<span><b>' + ordinal(f.weekCount) + '</b> session this week' + (f.weekTss ? ' · ' + f.weekTss + ' TSS' : '') + '</span></span>');

  const el = document.createElement('div');
  el.className = 'fin';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'finTitle');
  el.innerHTML = (opts.confetti ? '<div class="fin-confetti" aria-hidden="true">' + confetti(f.pbs.length ? 34 : 24) + '</div>' : '')
    + '<div class="fin-card">'
    + '<svg class="fin-mark" viewBox="0 0 64 64" aria-hidden="true"><circle class="fin-halo" cx="32" cy="32" r="29"/><circle class="fin-ring" cx="32" cy="32" r="29"/><path class="fin-tick" d="M20 33.5l8 8 16-17"/></svg>'
    + '<div class="fin-kicker fin-rise">' + esc(opts.kicker || 'Workout complete') + '</div>'
    + '<h2 class="fin-title fin-rise" id="finTitle">' + esc(opts.title || ride.workout_name || 'Free Ride') + '</h2>'
    + '<p class="fin-line fin-rise">' + esc(opts.line || (f.pbs.length ? 'New personal best. Great ride.' : 'Nice work. That one\'s in the bank.')) + '</p>'
    + '<div class="fin-stats fin-rise" style="--n:' + f.stats.length + ';grid-template-columns:' + (f.stats.length > 2 ? 'minmax(0, 1.4fr) ' : '') + 'repeat(' + (f.stats.length > 2 ? f.stats.length - 1 : f.stats.length) + ', minmax(0, 1fr))">' + f.stats.map(s => '<div class="fin-stat"><b' + (s.count ? ' data-count="' + s.v + '"' : '') + '>' + esc(s.v) + '</b><span>' + s.l + '</span></div>').join('') + '</div>'
    + (f.pbs.length ? '<div class="fin-pbs fin-rise">' + f.pbs.map(b => '<span class="fin-pb">' + STAR + 'New ' + pbLabel(b.d) + ' best · <b>' + b.w + ' W</b> <s>was ' + b.prev + '</s></span>').join('') + '</div>' : '')
    + (notes.length ? '<div class="fin-notes fin-rise">' + notes.join('') + '</div>' : '')
    + '<button class="primary fin-go fin-rise" type="button">' + esc(opts.button || 'See your summary') + '</button>'
    + '</div>';
  document.body.appendChild(el);
  // Count the numbers up once the stats row has risen into view.
  setTimeout(() => countUp(el, 900), 850);
  const btn = el.querySelector('.fin-go');
  const conf = el.querySelector('.fin-confetti');
  if (conf) setTimeout(() => conf.remove(), 5200);

  return new Promise(resolve => {
    function done(){
      document.removeEventListener('keydown', onKey);
      resolve();
      // Leave it up while the next page loads, so the ride screen doesn't flash back.
      if (opts.keep) return;
      el.remove();
    }
    function onKey(e){ if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); done(); } }
    btn.addEventListener('click', done);
    document.addEventListener('keydown', onKey);
  });
}

// A short, soft fall of paper from the top: a fixed handful of elements, each animated once.
function confetti(n){
  let out = '';
  for (let i = 0; i < n; i++){
    const left = (i + Math.random()) / n * 100;
    const c = CONFETTI[i % CONFETTI.length];
    out += '<i style="left:' + left.toFixed(1) + '%;background:' + c + ';--dx:' + Math.round((Math.random() - .5) * 120) + 'px;--r:' + Math.round(240 + Math.random() * 480) * (Math.random() < .5 ? -1 : 1) + 'deg;'
      + '--t:' + (2.6 + Math.random() * 1.6).toFixed(2) + 's;--dl:' + (0.5 + Math.random() * 0.9).toFixed(2) + 's;'
      + (Math.random() < .4 ? 'width:4px;height:8px;' : '') + '"></i>';
  }
  return out;
}
