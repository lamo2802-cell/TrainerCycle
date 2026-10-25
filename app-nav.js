// Phone bottom tab bar (see app-nav.css). Mounted from renderSidebarUserBadge in auth.js, which every
// signed-in page already calls, so pages don't each need wiring. The ride screens opt out.

const TABS = [
  { href:'index.html', label:'Today', match:/\/(index\.html)?$/,
    icon:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>' },
  { href:'calendar.html', label:'Calendar', match:/\/calendar\.html$/,
    icon:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
  { href:'builder.html', label:'Workouts', match:/\/(builder|create-workout)\.html$/,
    icon:'<path d="M3 20V14h3v6M9 20V9h3v11M15 20V4h3v16"/>' },
  { href:'rides.html', label:'Rides', match:/\/rides\.html$/,
    icon:'<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h5l3 8M10 9l-1.5-3H6M15 9l-2-3h3"/>' },
];
const MORE_ICON = '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>';

export function isRideScreen(){ return /\/(live|trainerstrength)(\.html)?$/.test(location.pathname); }

export function mountAppNav(){
  if (isRideScreen() || document.querySelector('.tabbar')) return;
  document.documentElement.classList.add('has-appnav');
  const path = location.pathname;
  const current = TABS.find(t => t.match.test(path));
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.setAttribute('aria-label', 'Main');
  nav.innerHTML = TABS.map(t =>
    '<a href="'+t.href+'"'+(t === current ? ' class="on" aria-current="page"' : '')+'><svg viewBox="0 0 24 24" aria-hidden="true">'+t.icon+'</svg>'+t.label+'</a>'
  ).join('') + '<button type="button" class="tab-more'+(current ? '' : ' on')+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+MORE_ICON+'</svg>More</button>';
  nav.querySelector('.tab-more').addEventListener('click', ()=>{
    const toggle = document.getElementById('sidebarToggle');
    if (toggle) toggle.click();
  });
  document.body.appendChild(nav);
}
