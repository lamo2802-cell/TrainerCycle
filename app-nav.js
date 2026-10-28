// App navigation (see app-nav.css), replacing the old ☰ side menu on signed-in pages.
// Desktop and tablet: links in the top bar (Today, Calendar, Training ▾, Progress), a Ride button and an
// account menu under your avatar. Phone: a bottom tab bar with a raised Start button in the middle; Training,
// Start and the account menu open as sheets from the bottom. Start names today's session (saved by Today in
// localStorage tc_today_session) and has the Log ride / run / swim buttons. Mounted from renderSidebarUserBadge in auth.js,
// which every signed-in page already calls. The ride screens get a back button instead.
import { ask } from './sheet.js?v=3';

const svg = (paths, cls = '') => '<svg viewBox="0 0 24 24" aria-hidden="true"'+(cls ? ' class="'+cls+'"' : '')+'>'+paths+'</svg>';
const ICONS = {
  today:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  training:'<path d="M4 6h16M4 12h11M4 18h7"/>',
  progress:'<path d="M4 19V10M10 19V5M16 19v-7M21 19H3"/>',
  play:'<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  bike:'<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h5l3 8M10 9l-1.5-3H6M15 9l-2-3h3"/>',
  plans:'<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="18" r=".6"/>',
  workouts:'<path d="M3 20V14h3v6M9 20V9h3v11M15 20V4h3v16"/>',
  run:'<circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v4M6.5 11.5l3.5-3 4 1 2.5 3"/>',
  strength:'<path d="M4 10v4M20 10v4M7 7v10M17 7v10M7 12h10"/>',
  swim:'<circle cx="16" cy="6" r="2"/><path d="M3 18c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M6 14l4-5 3 2 2-2"/>',
  builder:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M14 13h4M14 16h3"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.7v.4M12 17h.01"/>',
  signout:'<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  chevron:'<path d="M6 9l6 6 6-6"/>',
  back:'<path d="M15 5l-7 7 7 7"/>',
};

// Top-level destinations, in order. Training opens a menu rather than a page.
const MAIN = [
  { id:'today', href:'index.html', label:'Today', match:/\/(index\.html)?$/ },
  { id:'calendar', href:'calendar.html', label:'Calendar', match:/\/calendar\.html$/ },
  { id:'training', menu:'training', label:'Training', match:/\/(plans|plan-builder|builder|create-workout|trainerrun)\.html$/ },
  { id:'progress', href:'rides.html', label:'Progress', match:/\/rides\.html$/ },
];
const MENUS = {
  training:{ title:'Training', items:[
    { href:'plans.html', icon:'plans', label:'Your plan', text:'What you follow, change it, or build your own' },
    { href:'builder.html', icon:'workouts', label:'Workouts', text:'Ride library, levels and workout builder' },
    { href:'trainerrun.html', icon:'run', label:'TrainerRun', text:'Run paces, levels and race times' },
    { href:'trainerstrength.html', icon:'strength', label:'TrainerStrength', text:'Programme, sessions and lifts' },
  ]},
  ride:{ title:'Start', items:[] },   // built when opened: see startItems()
  account:{ title:'', items:[
    { href:'settings.html', icon:'settings', label:'Settings' },
    { href:'help.html', icon:'help', label:'How to use' },
    { action:'signout', icon:'signout', label:'Sign out' },
  ]},
};

// Today's session for the Start sheet, if Today has been opened today: { name, kind, href } or { none:true }.
function todaySession(){
  try {
    const t = JSON.parse(localStorage.getItem('tc_today_session') || 'null');
    const d = new Date(), iso = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    return t && t.date === iso ? t : null;
  } catch(_){ return null; }
}
const KIND_ICON = { ride:'bike', strength:'strength', run:'run', swim:'swim' };
function startItems(){
  const t = todaySession(), has = t && !t.none;
  const items = [];
  if (has) items.push({ href:t.href, icon:KIND_ICON[t.kind] || 'bike', label:t.name, text: t.kind === 'run' || t.kind === 'swim' ? 'Today\'s session · log it when you\'re done' : 'Today\'s session', today:true });
  items.push({ href:'live.html', icon:'bike', label:'Live Ride', text: has && t.kind === 'ride' ? 'Or ride something else on your trainer' : t ? 'Ride on your smart trainer' : 'Today\'s plan session is lined up for you' });
  items.push({ href:'builder.html', icon:'workouts', label:'Pick a workout', text:'Find a ride that fits the time you have' });
  items.push({ href:'trainerstrength.html', icon:'strength', label:'Strength session', text:'TrainerStrength' });
  return items;
}

// TrainerStrength's front page (html.ts-home) gets the full nav; its player is a ride screen
export function isRideScreen(){ return /\/live(\.html)?$/.test(location.pathname) || (/\/trainerstrength(\.html)?$/.test(location.pathname) && !document.documentElement.classList.contains('ts-home')); }

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const phone = () => window.matchMedia('(max-width:759px)').matches;

function userInfo(user){
  const md = (user && user.user_metadata) || {};
  const name = md.full_name || md.name || (user && user.email) || 'Account';
  return { name, email:(user && user.email) || '', avatar:md.avatar_url || '', initial:String(name).trim().charAt(0).toUpperCase() || '?' };
}
function avatarHtml(u){
  return u.avatar ? '<img src="'+esc(u.avatar)+'" alt="">' : esc(u.initial);
}

export function mountAppNav({ supabase, user } = {}){
  if (isRideScreen()){ mountBackButton(); return; }
  if (document.querySelector('.tabbar')) return;
  document.documentElement.classList.add('has-appnav');
  const path = location.pathname;
  const current = MAIN.find(t => t.match.test(path));
  const onAccount = /\/(settings|help)\.html$/.test(path);
  const u = userInfo(user);

  // ---- top bar (tablet and desktop) ----
  const bar = document.querySelector('.top-bar');
  if (bar){
    const logo = bar.querySelector('.top-bar-logo-link');
    const nav = document.createElement('nav');
    nav.className = 'topnav';
    nav.setAttribute('aria-label', 'Main');
    nav.innerHTML = MAIN.map(t => t.menu
      ? '<button type="button" class="tn-link'+(t === current ? ' on' : '')+'" data-menu="'+t.menu+'" aria-haspopup="true" aria-expanded="false">'+t.label+svg(ICONS.chevron, 'tn-caret')+'</button>'
      : '<a class="tn-link'+(t === current ? ' on' : '')+'" href="'+t.href+'"'+(t === current ? ' aria-current="page"' : '')+'>'+t.label+'</a>').join('');
    if (logo) logo.after(nav); else bar.prepend(nav);
    const ride = document.createElement('button');
    ride.type = 'button';
    ride.className = 'tn-ride';
    ride.dataset.menu = 'ride';
    ride.setAttribute('aria-haspopup', 'true');
    ride.setAttribute('aria-expanded', 'false');
    ride.innerHTML = svg(ICONS.play)+'Start';
    const me = document.createElement('button');
    me.type = 'button';
    me.className = 'tn-avatar'+(onAccount ? ' on' : '');
    me.dataset.menu = 'account';
    me.setAttribute('aria-haspopup', 'true');
    me.setAttribute('aria-expanded', 'false');
    me.setAttribute('aria-label', 'Account: '+u.name);
    me.innerHTML = avatarHtml(u);
    const fs = bar.querySelector('#fullscreenToggle');
    if (fs){ fs.before(ride); fs.after(me); } else { bar.append(ride, me); }
  }

  // ---- bottom tab bar (phone) ----
  const tabs = document.createElement('nav');
  tabs.className = 'tabbar';
  tabs.setAttribute('aria-label', 'Main');
  const tab = t => {
    const on = t === current ? ' on' : '';
    return t.menu
      ? '<button type="button" class="'+on.trim()+'" data-menu="'+t.menu+'" aria-haspopup="true" aria-expanded="false">'+svg(ICONS[t.id])+t.label+'</button>'
      : '<a href="'+t.href+'"'+(on ? ' class="on" aria-current="page"' : '')+'>'+svg(ICONS[t.id])+t.label+'</a>';
  };
  tabs.innerHTML = tab(MAIN[0]) + tab(MAIN[1])
    + '<button type="button" class="tab-ride" data-menu="ride" aria-haspopup="true" aria-expanded="false" aria-label="Start a session or log one"><span>'+svg(ICONS.play)+'</span></button>'
    + tab(MAIN[2]) + tab(MAIN[3]);
  document.body.appendChild(tabs);

  // ---- menus: a dropdown under its button on wide screens, a sheet from the bottom on a phone ----
  const backdrop = document.createElement('div');
  backdrop.className = 'navmenu-backdrop';
  const menu = document.createElement('div');
  menu.className = 'navmenu';
  menu.setAttribute('role', 'menu');
  document.body.append(backdrop, menu);
  let openBtn = null;

  function close(){
    if (!openBtn) return;
    openBtn.setAttribute('aria-expanded', 'false');
    openBtn = null;
    menu.classList.remove('open');
    backdrop.classList.remove('open');
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e){
    if (e.key === 'Escape'){ const b = openBtn; close(); if (b) b.focus(); }
  }
  function open(btn){
    const key = btn.dataset.menu, m = MENUS[key];
    if (openBtn === btn){ close(); return; }
    close();
    let h = '';
    if (key === 'account') h += '<div class="nm-who"><span class="nm-avatar">'+avatarHtml(u)+'</span><span><b>'+esc(u.name)+'</b>'+(u.email && u.email !== u.name ? '<small>'+esc(u.email)+'</small>' : '')+'</span></div>';
    else if (m.title) h += '<div class="nm-title">'+m.title+'</div>';
    h += (key === 'ride' ? startItems() : m.items).map(it => {
      const here = it.href && new RegExp('/'+it.href.replace('.', '\\.')+'$').test(path);
      const inner = '<span class="nm-ico">'+svg(ICONS[it.icon])+'</span><span class="nm-txt"><b>'+it.label+'</b>'+(it.text ? '<small>'+it.text+'</small>' : '')+'</span>';
      return it.href
        ? '<a role="menuitem" href="'+it.href+'"'+(here || it.today ? ' class="'+(it.today ? 'nm-today' : 'here')+'"' : '')+(here ? ' aria-current="page"' : '')+'>'+inner+'</a>'
        : '<button type="button" role="menuitem" data-action="'+it.action+'">'+inner+'</button>';
    }).join('');
    if (key === 'ride') h += '<div class="nm-log"><span>Log</span><button type="button" data-action="log-ride">Ride</button><button type="button" data-action="log-run">Run</button><button type="button" data-action="log-swim">Swim</button></div>';
    menu.innerHTML = h;
    menu.dataset.kind = key;
    if (!phone()){
      const r = btn.getBoundingClientRect();
      const w = key === 'account' ? 260 : 320;
      const left = Math.max(12, Math.min(window.innerWidth - w - 12, key === 'training' ? r.left : r.right - w));
      menu.style.cssText = 'top:'+(r.bottom + 8)+'px; left:'+left+'px; width:'+w+'px;';
    } else {
      menu.style.cssText = '';
    }
    openBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    menu.classList.add('open');
    backdrop.classList.add('open');
    document.addEventListener('keydown', onKey);
    const first = menu.querySelector('a, button');
    if (first && !phone()) first.focus({ preventScroll:true });
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-menu]');
    if (btn && (btn.closest('.topnav, .tabbar, .top-bar'))){ e.preventDefault(); open(btn); return; }
    const act = e.target.closest('.navmenu [data-action]');
    if (act && act.dataset.action === 'signout'){ close(); signOut(supabase); return; }
    if (act && /^log-/.test(act.dataset.action)){ close(); logActivity(supabase, user, act.dataset.action.slice(4)); return; }
    if (openBtn && !e.target.closest('.navmenu')) close();
  });
  window.addEventListener('resize', close);
}

// Log a ride, run or swim done elsewhere, from anywhere in the app; the page reloads to show it.
async function logActivity(supabase, user, sport){
  if (!supabase || !user) return;
  let saved;
  if (sport === 'ride'){
    const { openRideLog } = await import('./diary.js?v=2');
    let ftp = null; try { ftp = Number(localStorage.getItem('tc_ftp_' + user.id)) || null; } catch(_){}
    saved = await openRideLog(supabase, user.id, { ftp });
  } else if (sport === 'run'){
    const { openRunLog } = await import('./run.js?v=9');
    saved = await openRunLog(supabase, user.id, {});
  } else {
    const { openSwimLog } = await import('./swim.js?v=2');
    saved = await openSwimLog(supabase, user.id, {});
  }
  if (saved) location.reload();
}

async function signOut(supabase){
  if (!supabase) return;
  if (await ask('You can sign back in any time.', { title:'Sign out of TrainerCycle?', ok:'Sign out' })){
    await supabase.auth.signOut();
    location.href = 'index.html';
  }
}

// Live Ride and TrainerStrength fill the screen, so they get a plain back button in place of the menu.
function mountBackButton(){
  const toggle = document.getElementById('sidebarToggle');
  if (!toggle || document.querySelector('.nav-back')) return;
  const back = document.createElement('a');
  back.className = 'icon-btn nav-back';
  back.href = 'index.html';
  back.setAttribute('aria-label', 'Back to Today');
  back.innerHTML = svg(ICONS.back);
  back.addEventListener('click', async e => {
    e.preventDefault();
    const busy = document.querySelector('.live-layout.riding-active, .live-layout.session-active');
    if (busy && !(await ask('Your session is still running. Leaving now ends it.', { title:'Leave this session?', ok:'Leave', danger:true }))) return;
    let sameSite = false;
    try { sameSite = document.referrer && new URL(document.referrer).origin === location.origin; } catch(_){}
    if (sameSite && history.length > 1) history.back(); else location.href = 'index.html';
  });
  toggle.before(back);
  toggle.style.display = 'none'; // kept in the page: its own script still wires it up
}
