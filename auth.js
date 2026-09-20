import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function createSupabaseClient(){
  return createClient(
    'https://uqevjhysxzkivmjwggvu.supabase.co',
    'sb_publishable_SXXjaHNm8mfF8ZHUpYU9QQ_EJjq_E46'
  );
}

const GOOGLE_CLIENT_ID = '452232016404-njma4hqk5ut7587daeipq9sgcrk8fube.apps.googleusercontent.com';

function generateNonce(){
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2,'0')).join('');
}
async function sha256Hex(input){
  const enc = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

let gisScriptPromise = null;
function loadGoogleScript(){
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject)=>{
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google script'));
    document.head.appendChild(script);
    setTimeout(()=>reject(new Error('Timed out loading Google script')), 3000);
  });
  return gisScriptPromise;
}

// Renders Google's own Sign In With Google button into containerEl, so the whole sign-in exchange
// happens directly between the browser and Google (no Supabase redirect involved) - this is what
// keeps Google's own screen naming trainercycle.com instead of the raw Supabase project address.
// Calls onSignedIn(idToken, rawNonce) once the user completes sign-in via Google's button.
// Returns true if the button rendered successfully, false if the caller should fall back to the
// existing redirect-based flow instead (e.g. Google's script was blocked or failed to load).
export async function tryRenderGoogleButton(containerEl, onSignedIn, onError){
  try {
    await loadGoogleScript();
    if (!window.google || !window.google.accounts || !window.google.accounts.id) throw new Error('Google Identity Services unavailable');
    const rawNonce = generateNonce();
    const hashedNonce = await sha256Hex(rawNonce);
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response)=>{
        try { await onSignedIn(response.credential, rawNonce); }
        catch(e){ onError(e); }
      },
      nonce: hashedNonce
    });
    window.google.accounts.id.renderButton(containerEl, { theme:'outline', size:'large', width:260, text:'signin_with', shape:'rectangular' });
    return true;
  } catch(e){
    console.error('Google Identity Services unavailable, falling back to redirect sign-in:', e);
    return false;
  }
}

// Shares one signInWithIdToken call site for both sign-in entry points (the shared gate and Home's
// own hero card), so the nonce/error handling only needs to be right in one place.
export async function signInWithGoogleIdToken(supabase, idToken, nonce){
  return supabase.auth.signInWithIdToken({ provider:'google', token: idToken, nonce });
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
      '<div id="authGoogleBtnContainer" style="display:flex; justify-content:center; min-height:40px;"></div>' +
      '<button id="authGoogleBtn" style="display:none;">' +
      '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>' +
      'Sign in with Google' +
      '</button>' +
      '<div class="msg" id="authMsg"></div>' +
      '</div>';
    document.body.appendChild(gate);

    tryRenderGoogleButton(
      document.getElementById('authGoogleBtnContainer'),
      async (idToken, nonce)=>{
        const { error } = await signInWithGoogleIdToken(supabase, idToken, nonce);
        if (error) document.getElementById('authMsg').textContent = 'Error: ' + error.message;
      },
      ()=>{ document.getElementById('authMsg').textContent = 'Sign-in failed — try again.'; }
    ).then(rendered=>{
      if (!rendered) document.getElementById('authGoogleBtn').style.display = 'flex';
    });

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

function showWelcomeMessage(){
  const el = document.createElement('div');
  el.id = 'welcomeToast';
  el.innerHTML =
    '<style>' +
    '#welcomeToast{ position:fixed; inset:0; background:rgba(16,20,26,0.75); z-index:1001; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:20px; }' +
    '#welcomeToast .box{ background:#171D25; border:1px solid #45D6C4; border-radius:12px; padding:32px; max-width:360px; width:100%; text-align:center; }' +
    '#welcomeToast img{ width:56px; height:56px; border-radius:12px; margin-bottom:14px; }' +
    '#welcomeToast h2{ color:#E7ECF2; font-size:19px; margin:0 0 8px; }' +
    '#welcomeToast p{ color:#8C97A6; font-size:13.5px; margin:0 0 20px; line-height:1.5; }' +
    '#welcomeToast button{ width:100%; padding:11px; border-radius:6px; border:1px solid #45D6C4; background:#45D6C4; color:#08211E; font-weight:600; font-size:14px; cursor:pointer; }' +
    '</style>' +
    '<div class="box">' +
    '<img src="logo.svg" alt="TrainerCycle">' +
    '<h2>Welcome to TrainerCycle 🎉</h2>' +
    '<p>Your free trial has started — nothing is charged for 7 days. Connect your trainer in Live Ride, or start with a Ramp Test to set your FTP.</p>' +
    '<button id="welcomeCloseBtn">Let\'s go</button>' +
    '</div>';
  document.body.appendChild(el);
  document.getElementById('welcomeCloseBtn').addEventListener('click', ()=> el.remove());
}

// Checks the user's subscription status; shows a paywall gate and blocks until active.
export async function requireSubscription(supabase, user){
  const urlParams = new URLSearchParams(window.location.search);
  const justSubscribed = urlParams.get('subscribed') === '1';
  const activeStatuses = ['active', 'owner', 'trialing'];

  let { data } = await supabase.from('subscriptions').select('status').eq('user_id', user.id).maybeSingle();

  // Just returned from Stripe checkout, but the webhook that actually activates the subscription
  // may not have processed yet - briefly retry rather than immediately showing the paywall again.
  if (justSubscribed && !(data && activeStatuses.includes(data.status))){
    for (let i=0; i<5 && !(data && activeStatuses.includes(data.status)); i++){
      await new Promise(r=>setTimeout(r, 1500));
      ({ data } = await supabase.from('subscriptions').select('status').eq('user_id', user.id).maybeSingle());
    }
  }

  if (data && activeStatuses.includes(data.status)){
    if (justSubscribed){
      window.history.replaceState({}, '', window.location.pathname);
      showWelcomeMessage();
    }
    return true;
  }

  return new Promise((resolve)=>{
    const gate = document.createElement('div');
    gate.id = 'subGate';
    gate.innerHTML =
      '<style>' +
      '#subGate{ position:fixed; inset:0; background:#10141A; z-index:999; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow-y:auto; padding:24px 0; }' +
      '#subGate .box{ background:#171D25; border:1px solid #2A323D; border-radius:12px; padding:32px; max-width:400px; width:90%; text-align:center; }' +
      '#subGate img{ width:56px; height:56px; border-radius:12px; margin-bottom:14px; }' +
      '#subGate h2{ color:#E7ECF2; font-size:19px; margin:0 0 6px; }' +
      '#subGate p{ color:#8C97A6; font-size:13px; margin:0 0 18px; line-height:1.5; }' +
      '#subGate .price{ color:#45D6C4; font-size:26px; font-weight:700; margin-bottom:2px; }' +
      '#subGate .price span{ font-size:12.5px; color:#8C97A6; font-weight:400; }' +
      '#subGate .trial-badge{ display:inline-block; background:#1D242D; border:1px solid #45D6C4; color:#45D6C4; font-size:11.5px; font-weight:600; padding:3px 10px; border-radius:12px; margin-bottom:16px; }' +
      '#subGate .benefits{ text-align:left; list-style:none; padding:0; margin:0 0 20px; }' +
      '#subGate .benefits li{ display:flex; gap:8px; color:#E7ECF2; font-size:13px; margin-bottom:10px; line-height:1.4; }' +
      '#subGate .benefits li:before{ content:"✓"; color:#45D6C4; font-weight:700; flex-shrink:0; }' +
      '#subGate button{ width:100%; padding:12px; border-radius:6px; border:1px solid #45D6C4; background:#45D6C4; color:#08211E; font-weight:600; font-size:14.5px; cursor:pointer; margin-top:4px; }' +
      '#subGate button:disabled{ opacity:.5; cursor:not-allowed; }' +
      '#subGate .msg{ color:#8C97A6; font-size:12px; margin-top:12px; min-height:16px; }' +
      '</style>' +
      '<div class="box">' +
      '<img src="logo.svg" alt="TrainerCycle">' +
      '<h2>Start your free 7-day trial</h2>' +
      '<div class="trial-badge">7 days free, then £4.99/month</div>' +
      '<ul class="benefits">' +
      '<li>Live Bluetooth trainer control with real ERG resistance — the trainer actually holds your target power</li>' +
      '<li>A full workout library plus multi-week structured training plans</li>' +
      '<li>Cycling and strength training together, built around your FTP</li>' +
      '<li>Full ride history, TCX export, and automatic Strava upload</li>' +
      '<li>Cancel anytime — no charge at all if you cancel within your first 7 days</li>' +
      '</ul>' +
      '<div style="font-size:11px; color:#8C97A6; margin-bottom:14px; line-height:1.4; text-align:left; background:#1D242D; border-radius:6px; padding:10px 12px;">Requires a Bluetooth ERG-capable smart trainer, used in Chrome or Edge — <b>not supported in Safari or any browser on iOS.</b></div>' +
      '<button id="subBtn">Start Free Trial</button>' +
      '<div class="msg" id="subMsg"></div>' +
      '<div style="font-size:11px; color:#8C97A6; margin-top:16px;">By starting your trial you agree to our <a href="terms.html" style="color:#45D6C4;" target="_blank">Terms of Service</a> and <a href="privacy.html" style="color:#45D6C4;" target="_blank">Privacy Policy</a>. Your card is charged £4.99/month automatically starting 7 days from today unless you cancel before then.</div>' +
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

// Renders the user's avatar/name inline inside a sidebar container, with a sign-out action.
export function renderSidebarUserBadge(supabase, user, container){
  const avatarUrl = user.user_metadata && user.user_metadata.avatar_url;
  const label = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || user.email || 'Account';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; align-items:center; gap:10px; padding:14px 8px 4px; margin:24px -8px 0; border-top:1px solid #2A323D;';

  const avatarEl = document.createElement('span');
  avatarEl.style.cssText = 'width:32px; height:32px; border-radius:50%; background:#45D6C4; color:#08211E; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; overflow:hidden; flex-shrink:0;';
  if (avatarUrl){
    const img = document.createElement('img');
    img.src = avatarUrl; img.alt = ''; img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = (label || '?').trim().charAt(0).toUpperCase();
  }

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.cssText = 'color:#E7ECF2; font-size:12.5px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

  const signOutBtn = document.createElement('button');
  signOutBtn.textContent = 'Sign out';
  signOutBtn.style.cssText = 'width:auto; font-size:11px; padding:5px 10px; flex-shrink:0;';
  signOutBtn.addEventListener('click', async ()=>{
    if (confirm('Sign out of TrainerCycle?')){ await supabase.auth.signOut(); location.reload(); }
  });

  wrap.appendChild(avatarEl);
  wrap.appendChild(labelEl);
  wrap.appendChild(signOutBtn);
  container.appendChild(wrap);
}

// Adds a compact sign-out button into the given container element (legacy top-right usage).
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
