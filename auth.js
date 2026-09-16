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
