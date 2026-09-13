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
      '#authGate p{ color:#8C97A6; font-size:13px; margin:0 0 18px; line-height:1.4; }' +
      '#authGate input{ width:100%; padding:10px; border-radius:6px; border:1px solid #2A323D; background:#1D242D; color:#E7ECF2; font-size:14px; margin-bottom:10px; box-sizing:border-box; }' +
      '#authGate button{ width:100%; padding:10px; border-radius:6px; border:1px solid #45D6C4; background:#45D6C4; color:#08211E; font-weight:600; font-size:14px; cursor:pointer; }' +
      '#authGate button:disabled{ opacity:.5; cursor:not-allowed; }' +
      '#authGate .msg{ color:#8C97A6; font-size:12px; margin-top:12px; min-height:16px; }' +
      '</style>' +
      '<div class="box">' +
      '<img src="logo.svg" alt="TrainerCycle">' +
      '<h2>Sign in to TrainerCycle</h2>' +
      '<p>Enter your email and we\'ll send a one-time sign-in link — no password needed.</p>' +
      '<input type="email" id="authEmail" placeholder="you@example.com" autocomplete="email">' +
      '<button id="authSendBtn">Send sign-in link</button>' +
      '<div class="msg" id="authMsg"></div>' +
      '</div>';
    document.body.appendChild(gate);

    document.getElementById('authSendBtn').addEventListener('click', async ()=>{
      const email = document.getElementById('authEmail').value.trim();
      const msg = document.getElementById('authMsg');
      const btn = document.getElementById('authSendBtn');
      if (!email){ msg.textContent = 'Enter an email address.'; return; }
      btn.disabled = true;
      msg.textContent = 'Sending…';
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href }
      });
      msg.textContent = error ? ('Error: ' + error.message) : 'Check your email for the sign-in link.';
      btn.disabled = false;
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
