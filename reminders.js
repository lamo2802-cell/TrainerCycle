// Session reminders: a notification with today's session at a time the rider picks, and an evening nudge
// when it's still not done (with a one-tap move to tomorrow, see Today's ?move=). Settings key reminders
// holds { on, time, tz, missed, missedTime }; each device that gets them has a push_subscriptions row.
// The send-reminders edge function reads the sessions stored for the calendar feed (calfeed.js).

export const REMINDERS_KEY = 'reminders';
export const VAPID_PUBLIC_KEY = 'BL5jRJt7KlEPx4aRf-ERpuymdK4temJvPmhwk0WEApyD6DU1rwNyh_DOofFXhdXKKw7RbADZtS5zf8JHyMICH40';
export const DEFAULTS = { on:false, time:'07:00', missed:true, missedTime:'20:00' };

export function pushSupported(){
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
// iPhone and iPad only allow notifications once TrainerCycle is added to the Home Screen.
export function needsHomeScreen(){
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !(window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches);
}
export function timeZone(){
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'; } catch(_){ return 'Europe/London'; }
}

export async function loadReminders(supabase, userId){
  const { data } = await supabase.from('settings').select('value').eq('user_id', userId).eq('key', REMINDERS_KEY).maybeSingle();
  return Object.assign({}, DEFAULTS, data && data.value && data.value.v || {});
}
export async function saveReminders(supabase, userId, r){
  const value = { on:!!r.on, time:r.time, tz:timeZone(), missed:!!r.missed, missedTime:r.missedTime };
  const { error } = await supabase.from('settings').upsert({ user_id:userId, key:REMINDERS_KEY, value:{ v:value }, updated_at:new Date().toISOString() }, { onConflict:'user_id,key' });
  if (error) throw error;
  return value;
}

function keyBytes(b64){
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
async function registration(){
  return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.register('service-worker.js').then(() => navigator.serviceWorker.ready);
}
// This device's push subscription, or null.
export async function deviceSubscription(){
  if (!pushSupported()) return null;
  try { const reg = await registration(); return reg ? await reg.pushManager.getSubscription() : null; } catch(_){ return null; }
}
export async function deviceHasReminders(supabase, userId){
  const sub = await deviceSubscription();
  if (!sub) return false;
  const { data } = await supabase.from('push_subscriptions').select('id').eq('user_id', userId).eq('endpoint', sub.endpoint).maybeSingle();
  return !!data;
}

// Ask for permission and register this device. Throws Error('denied') if the rider blocks notifications.
export async function enableDevice(supabase, userId){
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:keyBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({ user_id:userId, endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth }, { onConflict:'user_id,endpoint' });
  if (error) throw error;
}
// Turning reminders off stops them on every device.
export async function disableAll(supabase, userId){
  const sub = await deviceSubscription();
  if (sub) { try { await sub.unsubscribe(); } catch(_){} }
  await supabase.from('push_subscriptions').delete().eq('user_id', userId);
}
