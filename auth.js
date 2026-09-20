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

// Shared password-strength rule, used by both signup and the reset-password page so the
// requirements shown to the user always match what's actually enforced.
export function passwordRequirements(pw){
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw)
  };
}
export function passwordValid(pw){
  const r = passwordRequirements(pw);
  return r.length && r.upper && r.lower && r.number && r.symbol;
}
// Renders a password input with a show/hide eye toggle button, so people can check what they typed.
export function passwordFieldHtml(id, placeholder, autocomplete){
  return '<div style="position:relative; margin-bottom:10px;">' +
    '<input type="password" id="'+id+'" placeholder="'+placeholder+'" autocomplete="'+autocomplete+'" style="margin-bottom:0; padding-right:38px;">' +
    '<button type="button" data-toggle-pw="'+id+'" style="position:absolute; right:4px; top:0; bottom:0; width:34px; padding:0; margin:0; background:transparent; border:none; color:#8C97A6; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center;">👁</button>' +
    '</div>';
}
function passwordChecklistHtml(id){
  return '<ul id="'+id+'" style="text-align:left; font-size:11.5px; color:#8C97A6; margin:2px 0 12px; padding-left:18px; list-style:none;">' +
    '<li data-req="length">○ At least 8 characters</li>' +
    '<li data-req="upper">○ One uppercase letter</li>' +
    '<li data-req="lower">○ One lowercase letter</li>' +
    '<li data-req="number">○ One number</li>' +
    '<li data-req="symbol">○ One symbol</li>' +
    '</ul>';
}
function updatePasswordChecklist(listId, pw){
  const r = passwordRequirements(pw);
  Object.keys(r).forEach(k=>{
    const li = document.querySelector('#'+listId+' [data-req="'+k+'"]');
    if (!li) return;
    li.textContent = (r[k] ? '✓ ' : '○ ') + li.textContent.slice(2);
    li.style.color = r[k] ? '#45D6C4' : '#8C97A6';
  });
}

// Records marketing-email consent (or its absence) with a timestamp, in the same settings table
// used for FTP/weight/etc, so there's an auditable record of when/whether it was given.
export async function saveMarketingConsent(supabase, userId, consented){
  return supabase.from('settings').upsert(
    { user_id:userId, key:'marketing_consent', value:{ v:consented, consented_at:new Date().toISOString() }, updated_at:new Date().toISOString() },
    { onConflict:'user_id,key' }
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
      '#authGate{ position:fixed; inset:0; background:#10141A; z-index:1000; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow-y:auto; padding:20px 0; }' +
      '#authGate .box{ background:#171D25; border:1px solid #2A323D; border-radius:12px; padding:32px; max-width:340px; width:90%; text-align:center; margin:auto; }' +
      '#authGate img.logo{ width:56px; height:56px; border-radius:12px; margin-bottom:14px; }' +
      '#authGate h2{ color:#E7ECF2; font-size:18px; margin:0 0 6px; }' +
      '#authGate p{ color:#8C97A6; font-size:13px; margin:0 0 20px; line-height:1.4; }' +
      '#authGate input[type=email], #authGate input[type=password], #authGate input[type=text]{ width:100%; box-sizing:border-box; padding:10px; margin-bottom:10px; border-radius:6px; border:1px solid #2A323D; background:#1D242D; color:#E7ECF2; font-size:13.5px; }' +
      '#authGate label.consent{ display:flex; align-items:flex-start; gap:8px; text-align:left; font-size:12px; color:#8C97A6; margin-bottom:14px; cursor:pointer; }' +
      '#authGate label.consent input{ margin-top:2px; flex-shrink:0; }' +
      '#authGate button{ width:100%; padding:11px; border-radius:6px; border:1px solid #2A323D; background:#fff; color:#1F1F1F; font-weight:600; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:10px; }' +
      '#authGate button.primary{ background:#45D6C4; color:#08211E; border-color:#45D6C4; }' +
      '#authGate button:disabled{ opacity:.5; cursor:not-allowed; }' +
      '#authGate .msg{ color:#8C97A6; font-size:12px; margin-top:4px; min-height:16px; }' +
      '#authGate .msg.error{ color:#E5484D; }' +
      '#authGate .divider{ display:flex; align-items:center; gap:10px; color:#8C97A6; font-size:11.5px; margin:14px 0; }' +
      '#authGate .divider::before, #authGate .divider::after{ content:""; flex:1; height:1px; background:#2A323D; }' +
      '#authGate .switch{ font-size:12.5px; color:#8C97A6; margin-top:6px; }' +
      '#authGate .switch a{ color:#45D6C4; cursor:pointer; text-decoration:underline; }' +
      '#authGate .back-home{ display:block; text-align:left; font-size:12.5px; color:#8C97A6; text-decoration:none; margin-bottom:16px; cursor:pointer; }' +
      '#authGate .back-home:hover{ color:#45D6C4; }' +
      '</style>' +
      '<div class="box">' +
      '<a class="back-home" id="authBackHome">← Back to Home</a>' +
      '<img class="logo" src="logo.svg" alt="TrainerCycle">' +

      '<div id="viewSignin">' +
      '<h2>Sign in to TrainerCycle</h2>' +
      '<p>Sign in to continue.</p>' +
      '<div id="authGoogleBtnContainer" style="display:flex; justify-content:center; min-height:40px;"></div>' +
      '<button id="authGoogleBtn" style="display:none;">' +
      '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>' +
      'Sign in with Google' +
      '</button>' +
      '<div class="divider">or</div>' +
      '<input type="email" id="siEmail" placeholder="Email" autocomplete="email">' +
      passwordFieldHtml('siPassword', 'Password', 'current-password') +
      '<button class="primary" id="siSubmit" style="background:#45D6C4;color:#08211E;border-color:#45D6C4;">Sign In</button>' +
      '<div class="switch"><a id="gotoForgot">Forgot password?</a></div>' +
      '<div class="switch">No account? <a id="gotoSignup">Sign up</a></div>' +
      '<div class="msg" id="siMsg"></div>' +
      '</div>' +

      '<div id="viewSignup" style="display:none;">' +
      '<h2>Create your account</h2>' +
      '<p>7 days free, then £4.99/month.</p>' +
      '<div id="authGoogleBtnContainer2" style="display:flex; justify-content:center; min-height:40px;"></div>' +
      '<button id="authGoogleBtn2" style="display:none;">' +
      '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>' +
      'Sign up with Google' +
      '</button>' +
      '<p style="font-size:11px; margin:-4px 0 14px; color:#8C97A6;">By continuing with Google, you agree to our <a href="terms.html" target="_blank" style="color:#45D6C4;">Terms of Service</a> and <a href="privacy.html" target="_blank" style="color:#45D6C4;">Privacy Policy</a>.</p>' +
      '<div class="divider">or</div>' +
      '<input type="email" id="suEmail" placeholder="Email" autocomplete="email">' +
      passwordFieldHtml('suPassword', 'Password', 'new-password') +
      passwordFieldHtml('suPasswordConfirm', 'Confirm password', 'new-password') +
      passwordChecklistHtml('suChecklist') +
      '<label class="consent"><input type="checkbox" id="suTerms">I agree to the <a href="terms.html" target="_blank" style="color:#45D6C4;">Terms of Service</a> and <a href="privacy.html" target="_blank" style="color:#45D6C4;">Privacy Policy</a>.</label>' +
      '<label class="consent"><input type="checkbox" id="suMarketing">I\'d like to receive occasional training tips and updates from TrainerCycle by email. You can change this anytime in Settings.</label>' +
      '<button class="primary" id="suSubmit" style="background:#45D6C4;color:#08211E;border-color:#45D6C4;">Create Account</button>' +
      '<div class="switch">Already have an account? <a id="gotoSignin">Sign in</a></div>' +
      '<div class="msg" id="suMsg"></div>' +
      '</div>' +

      '<div id="viewForgot" style="display:none;">' +
      '<h2>Reset your password</h2>' +
      '<p>Enter your email and we\'ll send you a reset link.</p>' +
      '<input type="email" id="fpEmail" placeholder="Email" autocomplete="email">' +
      '<button class="primary" id="fpSubmit" style="background:#45D6C4;color:#08211E;border-color:#45D6C4;">Send Reset Link</button>' +
      '<div class="switch"><a id="gotoSigninFromForgot">Back to sign in</a></div>' +
      '<div class="msg" id="fpMsg"></div>' +
      '</div>' +

      '<div id="viewCheckEmail" style="display:none;">' +
      '<div style="font-size:40px; margin-bottom:6px;">📬</div>' +
      '<h2>Check your email</h2>' +
      '<p>We\'ve sent a confirmation link to <b id="checkEmailAddress" style="color:#E7ECF2;"></b>. Click the link to activate your account, then come back and sign in.</p>' +
      '<div class="switch"><a id="gotoSigninFromCheck">Back to sign in</a></div>' +
      '</div>' +

      '</div>';
    document.body.appendChild(gate);

    document.getElementById('authBackHome').addEventListener('click', ()=>{
      const path = window.location.pathname;
      const onHome = path === '/' || path.endsWith('/index.html');
      if (onHome) gate.remove();
      else window.location.href = 'index.html';
    });

    gate.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-toggle-pw]');
      if (!btn) return;
      const input = document.getElementById(btn.dataset.togglePw);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });

    function showView(name){
      ['Signin','Signup','Forgot','CheckEmail'].forEach(v=>{
        document.getElementById('view'+v).style.display = (v.toLowerCase()===name) ? 'block' : 'none';
      });
    }
    document.getElementById('gotoSignup').addEventListener('click', ()=>showView('signup'));
    document.getElementById('gotoSignin').addEventListener('click', ()=>showView('signin'));
    document.getElementById('gotoForgot').addEventListener('click', ()=>showView('forgot'));
    document.getElementById('gotoSigninFromForgot').addEventListener('click', ()=>showView('signin'));
    document.getElementById('gotoSigninFromCheck').addEventListener('click', ()=>showView('signin'));

    // Google button - rendered twice (sign-in view and sign-up view do the exact same thing;
    // Google itself doesn't distinguish "signup" from "signin", it just authenticates).
    async function setupGoogle(containerId, btnId){
      const rendered = await tryRenderGoogleButton(
        document.getElementById(containerId),
        async (idToken, nonce)=>{
          const { error } = await signInWithGoogleIdToken(supabase, idToken, nonce);
          if (error){ document.getElementById('siMsg').textContent = 'Error: ' + error.message; }
        },
        ()=>{ document.getElementById('siMsg').textContent = 'Sign-in failed — try again.'; }
      );
      if (!rendered) document.getElementById(btnId).style.display = 'flex';
    }
    setupGoogle('authGoogleBtnContainer', 'authGoogleBtn');
    setupGoogle('authGoogleBtnContainer2', 'authGoogleBtn2');
    [ 'authGoogleBtn', 'authGoogleBtn2' ].forEach(id=>{
      document.getElementById(id).addEventListener('click', async ()=>{
        const btn = document.getElementById(id);
        btn.disabled = true;
        const { error } = await supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.href } });
        if (error){ document.getElementById('siMsg').textContent = 'Error: ' + error.message; btn.disabled = false; }
      });
    });

    // Sign in with email/password
    document.getElementById('siSubmit').addEventListener('click', async ()=>{
      const email = document.getElementById('siEmail').value.trim();
      const password = document.getElementById('siPassword').value;
      const msg = document.getElementById('siMsg');
      msg.className = 'msg'; msg.textContent = '';
      if (!email || !password){ msg.className='msg error'; msg.textContent = 'Enter your email and password.'; return; }
      const btn = document.getElementById('siSubmit');
      btn.disabled = true;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error){
        msg.className='msg error';
        msg.textContent = error.message + ' If you originally signed up with Google, use the Google button above instead of a password.';
        btn.disabled = false;
      }
    });

    // Live password checklist on signup
    document.getElementById('suPassword').addEventListener('input', (e)=>{
      updatePasswordChecklist('suChecklist', e.target.value);
    });

    // Sign up with email/password
    document.getElementById('suSubmit').addEventListener('click', async ()=>{
      const email = document.getElementById('suEmail').value.trim();
      const password = document.getElementById('suPassword').value;
      const passwordConfirm = document.getElementById('suPasswordConfirm').value;
      const marketing = document.getElementById('suMarketing').checked;
      const agreedTerms = document.getElementById('suTerms').checked;
      const msg = document.getElementById('suMsg');
      msg.className = 'msg'; msg.textContent = '';
      if (!email){ msg.className='msg error'; msg.textContent = 'Enter your email.'; return; }
      if (!agreedTerms){ msg.className='msg error'; msg.textContent = 'You need to agree to the Terms of Service and Privacy Policy to continue.'; return; }
      if (!passwordValid(password)){ msg.className='msg error'; msg.textContent = 'Password doesn\'t meet the requirements above.'; return; }
      if (password !== passwordConfirm){ msg.className='msg error'; msg.textContent = 'Passwords don\'t match.'; return; }
      const btn = document.getElementById('suSubmit');
      btn.disabled = true;
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error){ msg.className='msg error'; msg.textContent = error.message; btn.disabled = false; return; }
      // Supabase deliberately returns a fake, session-less "success" for an email that's already
      // registered (to prevent account enumeration) - session is null either way, so the only
      // reliable signal is an empty identities array, which only happens on the already-exists path.
      const alreadyExists = data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
      if (alreadyExists){
        msg.className = 'msg error';
        msg.innerHTML = 'An account already exists for that email. <a id="suGotoSigninInline" style="color:#45D6C4; cursor:pointer; text-decoration:underline;">Sign in instead</a>, or use "Forgot password?" if you don\'t remember it.';
        document.getElementById('suGotoSigninInline').addEventListener('click', ()=>{
          document.getElementById('siEmail').value = email;
          showView('signin');
        });
        btn.disabled = false;
        return;
      }
      if (data && data.user){
        try { await saveMarketingConsent(supabase, data.user.id, marketing); } catch(e){ /* non-fatal */ }
      }
      if (data && data.session){
        // Email confirmation is off - signed in immediately, gate will close via onAuthStateChange
      } else {
        document.getElementById('checkEmailAddress').textContent = email;
        showView('checkemail');
      }
    });

    // Forgot password
    document.getElementById('fpSubmit').addEventListener('click', async ()=>{
      const email = document.getElementById('fpEmail').value.trim();
      const msg = document.getElementById('fpMsg');
      msg.className = 'msg'; msg.textContent = '';
      if (!email){ msg.className='msg error'; msg.textContent = 'Enter your email.'; return; }
      const btn = document.getElementById('fpSubmit');
      btn.disabled = true;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password.html'
      });
      btn.disabled = false;
      // Supabase deliberately doesn't reveal whether the email exists, to prevent user enumeration -
      // show the same message either way.
      msg.style.color = '#45D6C4';
      msg.textContent = 'If an account exists for that email, a reset link is on its way.';
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
