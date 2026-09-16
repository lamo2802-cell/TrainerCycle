import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function createSupabaseClient(){
  return createClient(
    'https://uqevjhysxzkivmjwggvu.supabase.co',
    'sb_publishable_SXXjaHNm8mfF8ZHUpYU9QQ_EJjq_E46'
  );
}

// Shows a full-screen sign-in gate until the user is authenticated, then resolves with the user object.
export function requireAuth(supabase){
  return new Promise((resolve)=>{
    let resolved = false;
    const gate = document.createElement('div');
    gate.id = 'authGate';
    gate.innerHTML =
      '<style>' +
      '#authGate{ position:fixed; inset:0; background:#10141A; z-index:1000; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }' +
      '#authGate .box{ background:#171D25; border:1px solid #2A323D; border-radius:12px; padding:32px; max-width:340px; width:90%; text-align:center; }' +
      '#authGate img{ width:56px; height:56px; border-radius:12px; margin-bottom:14px; }' +
      '#authGate h2{ color:#E7ECF2; font-size:18px; margin:0 0 6px; }' +
      '#authGate p{ color:#8C97A6; font-size:13px; margin:0 0 20px; line-height:1.4; }' +
      '#authGate button{ width:100%; padding:11px; border-radius:6px; border:1px solid #2A323D; background:#fff; color:#1F1F1F; font-weight:600; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; }' +
      '#authGate button:disabled{ opacity:.5; cursor:not-allowed; }' +
      '#authGate .msg{ color:#8C97A6; font-size:12px; margin-top:14px; min-height:16px; }' +
      '</style>' +
      '<div class="box">' +
      '<img src="logo.svg" alt="TrainerCycle">' +
      '<h2>Sign in to TrainerCycle</h2>' +
      '<p>Sign in with your Google account to continue.</p>' +
      '<button id="authGoogleBtn">' +
      '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>' +
      'Sign in with Google' +
      '</button>' +
      '<div class="msg" id="authMsg"></div>' +
      '</div>';
    document.body.appendChild(gate);

    document.getElementById('authGoogleBtn').addEventListener('click', async ()=>{
      const btn = document.getElementById('authGoogleBtn');
      const msg = document.getElementById('authMsg');
      btn.disabled = true;
      msg.textContent = 'Redirecting to Google…';
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href }
      });
      if (error){ msg.textContent = 'Error: ' + error.message; btn.disabled = false; }
    });

    function done(user){
      if (resolved) return;
      resolved = true;
      gate.remove();
      resolve(user);
    }

    supabase.auth.onAuthStateChange((event, session)=>{
      if (session) done(session.user);
    });

    supabase.auth.getSession().then(({data:{session}})=>{
      if (session) done(session.user);
    });
  });
}

// Shows a compact user badge (avatar + name/email) fixed top-right; click to sign out.
export function addUserBadge(supabase, user){
  const badge = document.createElement('div');
  badge.id = 'userBadge';
  badge.title = 'Click to sign out';

  const style = document.createElement('style');
  style.textContent =
    '#userBadge{ position:fixed; top:14px; right:14px; z-index:50; display:flex; align-items:center; gap:8px; background:#171D25; border:1px solid #2A323D; border-radius:24px; padding:5px 12px 5px 5px; cursor:pointer; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }' +
    '#userBadge:hover{ border-color:#45D6C4; }' +
    '#userBadge .avatar{ width:28px; height:28px; border-radius:50%; background:#45D6C4; color:#08211E; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; overflow:hidden; flex-shrink:0; }' +
    '#userBadge .avatar img{ width:100%; height:100%; object-fit:cover; }' +
    '#userBadge .label{ color:#E7ECF2; font-size:12.5px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }' +
    '@media (max-width:480px){ #userBadge .label{ display:none; } #userBadge{ padding:5px; } }';
  badge.appendChild(style);

  const avatarUrl = user.user_metadata && user.user_metadata.avatar_url;
  const label = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || user.email || 'Account';

  const avatarEl = document.createElement('span');
  avatarEl.className = 'avatar';
  if (avatarUrl){
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.alt = '';
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = (label || '?').trim().charAt(0).toUpperCase();
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;

  badge.appendChild(avatarEl);
  badge.appendChild(labelEl);

  badge.addEventListener('click', async ()=>{
    if (confirm('Sign out of TrainerCycle?')){
      await supabase.auth.signOut();
      location.reload();
    }
  });
  document.body.appendChild(badge);
}

// Checks the user's subscription status; shows a paywall gate and blocks until active.
export async function requireSubscription(supabase, user){
  const { data } = await supabase.from('subscriptions').select('status').eq('user_id', user.id).maybeSingle();
  const activeStatuses = ['active', 'owner', 'trialing'];
  if (data && activeStatuses.includes(data.status)) return true;

  return new Promise((resolve)=>{
    const gate = document.createElement('div');
    gate.id = 'subGate';
    gate.innerHTML =
      '<style>' +
      '#subGate{ position:fixed; inset:0; background:#10141A; z-index:999; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }' +
      '#subGate .box{ background:#171D25; border:1px solid #2A323D; border-radius:12px; padding:32px; max-width:360px; width:90%; text-align:center; }' +
      '#subGate img{ width:56px; height:56px; border-radius:12px; margin-bottom:14px; }' +
      '#subGate h2{ color:#E7ECF2; font-size:18px; margin:0 0 6px; }' +
      '#subGate p{ color:#8C97A6; font-size:13px; margin:0 0 18px; line-height:1.5; }' +
      '#subGate .price{ color:#45D6C4; font-size:28px; font-weight:700; margin-bottom:4px; }' +
      '#subGate .price span{ font-size:13px; color:#8C97A6; font-weight:400; }' +
      '#subGate button{ width:100%; padding:11px; border-radius:6px; border:1px solid #45D6C4; background:#45D6C4; color:#08211E; font-weight:600; font-size:14px; cursor:pointer; margin-top:14px; }' +
      '#subGate button:disabled{ opacity:.5; cursor:not-allowed; }' +
      '#subGate .msg{ color:#8C97A6; font-size:12px; margin-top:12px; min-height:16px; }' +
      '</style>' +
      '<div class="box">' +
      '<img src="logo.svg" alt="TrainerCycle">' +
      '<h2>Subscribe to TrainerCycle</h2>' +
      '<div class="price">£3<span>–5 / month</span></div>' +
      '<p>Structured cycling and strength training, built around your FTP — live trainer control, training plans, and full ride history.</p>' +
      '<button id="subBtn">Subscribe</button>' +
      '<div class="msg" id="subMsg"></div>' +
      '</div>';
    document.body.appendChild(gate);

    document.getElementById('subBtn').addEventListener('click', async ()=>{
      const btn = document.getElementById('subBtn');
      const msg = document.getElementById('subMsg');
      btn.disabled = true;
      msg.textContent = 'Setting up checkout…';
      const { data: fnData, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { returnUrl: window.location.href }
      });
      if (error || !fnData || !fnData.url){
        msg.textContent = 'Checkout isn\'t available yet — try again shortly.';
        btn.disabled = false;
        return;
      }
      window.location.href = fnData.url;
    });
    // Note: this gate does not auto-resolve — a real subscription redirects away to Stripe
    // and back, at which point the page reloads and this check runs again.
  });
}

// Adds a compact sign-out button into the given container element.
export function addSignOutButton(supabase, container){
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.style.width = 'auto';
  btn.style.fontSize = '11px';
  btn.style.padding = '0 10px';
  btn.textContent = 'Sign out';
  btn.title = 'Sign out of TrainerCycle';
  btn.addEventListener('click', async ()=>{
    await supabase.auth.signOut();
    location.reload();
  });
  container.appendChild(btn);
}
