// One-time "What's new" sheet for riders who were already here before the 25-26 Oct 2026 releases.
// Shown once on Today; the settings row records which release they've seen, so a later release can
// bump WHATS_NEW_ID and show its own list. Brand-new riders get the first-week setup instead.
import { showSheet } from './sheet.js?v=2';

export const WHATS_NEW_KEY = 'whats_new_seen';
export const WHATS_NEW_ID = '2026-10-26';
// Accounts made after this already started on the new app.
const RELEASED_AT = '2026-10-25T15:00:00Z';

const ICON = {
  nav:      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 20v-4h8v4"/>',
  live:     '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/><path d="M9 2h6"/>',
  suggest:  '<path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 15h4"/>',
  multi:    '<path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><circle cx="16" cy="6" r="2"/><path d="M4 13l5-6 4 3 3-1"/>',
  progress: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  strength: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
  route:    '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
};

const ITEMS = [
  { icon:'nav', title:'A new way around',
    text:'A top bar on bigger screens and a tab bar on phones, with Ride one tap away.' },
  { icon:'live', title:'More control on Live Ride', href:'live.html',
    text:'+30s, −30s and Easier change just the interval you\'re on, and voice cues call out each change.' },
  { icon:'suggest', title:'A ride for the time you\'ve got', href:'builder.html',
    text:'Today suggests a ride that fits your time, and the library has more rides at 45, 60, 75 and 90 minutes.' },
  { icon:'calendar', title:'Calendar notes and activities', href:'calendar.html',
    text:'Add notes, log activities done off the trainer, plan a single workout on any day, and see your plan in your phone\'s calendar.' },
  { icon:'multi', title:'Swims, triathlon and duathlon', href:'plans.html',
    text:'Log swims, build your own plan with the plan builder, or start a ready-made tri or duathlon plan.' },
  { icon:'progress', title:'Progress, all in one place', href:'rides.html?view=performance',
    text:'Fitness & form, Records and a Performance dashboard with your power curve, FTP history and time in zone.' },
  { icon:'strength', title:'TrainerStrength grows up', href:'trainerstrength.html',
    text:'Sessions save, every set logs weight and reps, weights go up automatically, and programmes fit around your riding.' },
  { icon:'route', title:'Route maps and ride images', href:'rides.html',
    text:'Strava rides show their route on a map, and any ride can be shared as an image.' },
];

const CSS = '<style>'
  + '.tc-new .n-sub{margin:0 0 12px;font-size:14px;color:#B4BDC9;line-height:1.5}'
  + '.tc-new .n-list{display:flex;flex-direction:column;gap:2px;margin:0 -8px}'
  + '.tc-new .n-item{display:flex;gap:12px;align-items:flex-start;padding:9px 8px;border-radius:10px;color:inherit;text-decoration:none}'
  + '.tc-new a.n-item:hover{background:#1D242D}'
  + '.tc-new .n-ic{flex:none;width:34px;height:34px;border-radius:9px;background:rgba(69,214,196,.12);display:flex;align-items:center;justify-content:center}'
  + '.tc-new .n-ic svg{width:19px;height:19px;fill:none;stroke:#45D6C4;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
  + '.tc-new .n-item b{display:block;font-size:14px;font-weight:600;color:#E7ECF2;margin:1px 0 2px}'
  + '.tc-new .n-item span{display:block;font-size:12.5px;color:#8B96A5;line-height:1.45}'
  + '.tc-new .n-go{color:#45D6C4;font-weight:600;font-style:normal;white-space:nowrap}'
  // keep Got it in view while the list scrolls on phones
  + '.tc-sheet:has(.tc-new) .tc-sheet-btns{position:sticky;bottom:-16px;margin:12px -20px -16px;padding:12px 20px 16px;background:#171D25;border-top:1px solid #2A323D}'
  + '@media (max-width:600px){.tc-sheet:has(.tc-new) .tc-sheet-btns{margin:12px -18px calc(-16px - env(safe-area-inset-bottom, 0px));padding:12px 18px calc(16px + env(safe-area-inset-bottom, 0px));bottom:calc(-16px - env(safe-area-inset-bottom, 0px))}}'
  + '</style>';

const seenLocal = user => 'tc_whats_new_' + WHATS_NEW_ID + '_' + user.id;

// seenId: the stored whats_new_seen value. isNew: the rider is getting the first-week setup.
export function shouldShowWhatsNew({ user, seenId, isNew }){
  if (isNew || seenId === WHATS_NEW_ID) return false;
  if (user.created_at && user.created_at >= RELEASED_AT) return false;
  if (new URLSearchParams(location.search).get('subscribed') === '1') return false;
  try { if (localStorage.getItem(seenLocal(user))) return false; } catch(_){}
  return true;
}

// Settings row for this release, also written by the first-week setup so new riders never see it.
export function whatsNewRow(user){
  return { user_id:user.id, key:WHATS_NEW_KEY, value:{ v:WHATS_NEW_ID }, updated_at:new Date().toISOString() };
}

export async function openWhatsNew({ supabase, user }){
  // Mark it seen as soon as it opens, so following a link counts too.
  try { localStorage.setItem(seenLocal(user), '1'); } catch(_){}
  supabase.from('settings').upsert(whatsNewRow(user), { onConflict:'user_id,key' }).then(()=>{}, ()=>{});
  const box = document.createElement('div');
  box.className = 'tc-new';
  box.innerHTML = CSS + '<p class="n-sub">We\'ve added a lot over the last few days. Here\'s the short version.</p><div class="n-list">'
    + ITEMS.map(it => {
      const inner = '<i class="n-ic"><svg viewBox="0 0 24 24" aria-hidden="true">'+ICON[it.icon]+'</svg></i>'
        + '<div><b>'+it.title+'</b><span>'+it.text+(it.href ? ' <em class="n-go">Take a look →</em>' : '')+'</span></div>';
      return it.href ? '<a class="n-item" href="'+it.href+'">'+inner+'</a>' : '<div class="n-item">'+inner+'</div>';
    }).join('') + '</div>';
  await showSheet({ title:'What\'s new in TrainerCycle', content:box, buttons:[{ label:'Got it', value:true, kind:'primary' }], dismissValue:true });
}
