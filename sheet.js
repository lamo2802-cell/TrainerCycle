// In-app replacements for alert()/confirm(): a small sheet that matches the app instead of the
// browser's grey box. Bottom sheet on phones, centred card on larger screens. Styles are injected
// here so pages only need the import.

const CSS = `
.tc-sheet-back{ position:fixed; inset:0; z-index:1000; background:rgba(8,10,14,.62); display:flex; align-items:center; justify-content:center; padding:20px;
  opacity:0; transition:opacity .16s ease; }
.tc-sheet-back.on{ opacity:1; }
.tc-sheet{ width:100%; max-width:420px; background:#171D25; border:1px solid #2A323D; border-radius:14px; padding:20px 20px 16px;
  box-shadow:0 18px 50px rgba(0,0,0,.45); transform:translateY(8px); transition:transform .16s ease; color:#E7ECF2; font-family:inherit; }
.tc-sheet-back.on .tc-sheet{ transform:none; }
.tc-sheet h3{ margin:0 0 8px; font-size:17px; font-weight:700; line-height:1.3; }
.tc-sheet p{ margin:0 0 6px; font-size:14px; line-height:1.5; color:#B4BDC9; white-space:pre-line; }
.tc-sheet{ max-height:calc(100vh - 40px); overflow-y:auto; }
.tc-sheet .tc-sheet-btns{ display:flex; flex-direction:row-reverse; gap:8px; margin-top:16px; }
.tc-sheet .tc-sheet-btns button{ flex:1; width:auto; margin:0; padding:12px 14px; font-size:14.5px; font-weight:600; border-radius:9px; cursor:pointer;
  background:#1D242D; border:1px solid #2A323D; color:#E7ECF2; font-family:inherit; }
.tc-sheet .tc-sheet-btns button.primary{ background:#45D6C4; border-color:#45D6C4; color:#0B0E12; }
.tc-sheet .tc-sheet-btns button.danger{ background:rgba(229,72,77,.14); border-color:#E5484D; color:#FF8A8D; }
@media (max-width:600px){
  .tc-sheet-back{ align-items:flex-end; padding:0; }
  .tc-sheet{ max-width:none; border-radius:16px 16px 0 0; padding:20px 18px calc(16px + env(safe-area-inset-bottom, 0px)); transform:translateY(24px); }
  .tc-sheet .tc-sheet-btns{ flex-direction:column; }
}`;

function ensureStyle(){
  if (document.getElementById('tc-sheet-style')) return;
  const s = document.createElement('style');
  s.id = 'tc-sheet-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// buttons: [{ label, value, kind:'primary'|'danger'|undefined }], first one is the main action.
// Resolves with the chosen button's value, or `dismissValue` on Escape / tapping outside.
// content: an optional element (e.g. a small form) shown above the buttons.
// onAction(value): optional check before closing; return false (or a promise of false) to keep it open.
export function showSheet({ title = '', text = '', content = null, buttons = [{ label:'OK', value:true, kind:'primary' }], dismissValue = null, onAction = null } = {}){
  ensureStyle();
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'tc-sheet-back';
    const sheet = document.createElement('div');
    sheet.className = 'tc-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    if (title){ const h = document.createElement('h3'); h.textContent = title; sheet.appendChild(h); }
    if (text){ const p = document.createElement('p'); p.textContent = text; sheet.appendChild(p); }
    if (content) sheet.appendChild(content);
    const row = document.createElement('div');
    row.className = 'tc-sheet-btns';
    let done = false;
    function close(v){
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      back.classList.remove('on');
      setTimeout(()=> back.remove(), 170);
      resolve(v);
    }
    function onKey(e){ if (e.key === 'Escape'){ e.stopPropagation(); close(dismissValue); } }
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      if (b.kind) btn.className = b.kind;
      btn.addEventListener('click', async ()=>{
        if (onAction && b.value !== dismissValue){
          btn.disabled = true;
          let ok = true;
          try { ok = (await onAction(b.value)) !== false; } finally { btn.disabled = false; }
          if (!ok) return;
        }
        close(b.value);
      });
      row.appendChild(btn);
    });
    sheet.appendChild(row);
    back.appendChild(sheet);
    back.addEventListener('click', e => { if (e.target === back) close(dismissValue); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    requestAnimationFrame(()=> back.classList.add('on'));
    const first = row.querySelector('button');
    if (first && !content) first.focus({ preventScroll:true });
  });
}

export function notify(text, title = ''){
  return showSheet({ title, text, buttons:[{ label:'OK', value:true, kind:'primary' }], dismissValue:true });
}

export async function ask(text, { title = '', ok = 'OK', cancel = 'Cancel', danger = false } = {}){
  return !!(await showSheet({ title, text, buttons:[{ label:ok, value:true, kind: danger ? 'danger' : 'primary' }, { label:cancel, value:false }], dismissValue:false }));
}
