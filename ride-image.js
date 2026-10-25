// Shareable ride card: the TrainerCycle logo, the ride chart and key stats on the app's dark background as a 1080x1350 PNG (4:5, the
// shape Strava and Instagram show without cropping). Made in the browser from the ride's samples; nothing
// is uploaded. On phones that can share files it opens the share sheet (save to Photos, then add it to the
// Strava activity); elsewhere it downloads.

const W = 1080, H = 1350;
const C = { bg:'#10141A', panel:'#171D25', line:'#2A323D', text:'#E7ECF2', dim:'#8C97A6', accent:'#45D6C4', hr:'#E5484D' };
const ZONES = [
  { max:60, hex:'#5A6472' }, { max:76, hex:'#4C8BF5' }, { max:91, hex:'#3DBE7A' }, { max:106, hex:'#E8B93D' },
  { max:121, hex:'#F08A3C' }, { max:151, hex:'#E5484D' }, { max:Infinity, hex:'#B14AED' },
];
const zoneHex = pct => (ZONES.find(z => pct < z.max) || ZONES[ZONES.length - 1]).hex;

function fmtDur(sec){
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// Shrinks the font until the text fits on one line.
function fitText(ctx, text, maxW, size, weight, family){
  let s = size;
  do { ctx.font = weight + ' ' + s + 'px ' + family; s -= 2; } while (ctx.measureText(text).width > maxW && s > 24);
  return text;
}

// The TrainerCycle dial (logo.svg), drawn straight onto the card so it sits on the background with no box.
function dial(ctx, cx, cy, r){
  const k = r / 42;
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.line; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#3A4450'; ctx.lineWidth = 2.5 * k;
  [[0, -36], [28.4, -18], [28.4, 18], [0, 36], [-28.4, 18], [-28.4, -18]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + x * k, cy + y * k); ctx.stroke(); });
  ctx.strokeStyle = C.accent; ctx.lineWidth = 6 * k; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, Math.atan2(22.6, -34.5)); ctx.stroke();
  ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(cx, cy, 8 * k, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.text; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 16 * k, cy - 30 * k); ctx.stroke();
  ctx.lineCap = 'butt';
}

// ride: completed_rides row. sec: per-second samples ({power, hr, target}). ftp: FTP at the time. pbs: [{label, w}].
export async function rideImageBlob({ ride, sec, ftp, pbs = [] }){
  const sans = "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";
  try { await Promise.all(['700 84px Inter', '600 24px Inter', '700 58px "JetBrains Mono"', '500 22px "JetBrains Mono"'].map(f => document.fonts.load(f))); } catch(_){}

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#131922'); bg.addColorStop(1, '#0C1015');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 250, 0, W / 2, 250, 520);
  glow.addColorStop(0, 'rgba(69,214,196,.16)'); glow.addColorStop(1, 'rgba(69,214,196,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // logo: dial, wordmark, tagline
  dial(ctx, W / 2, 230, 118);
  ctx.font = '700 84px ' + sans; ctx.textBaseline = 'alphabetic';
  const tw = ctx.measureText('Trainer').width, cwid = ctx.measureText('Cycle').width, lx = (W - tw - cwid) / 2;
  ctx.fillStyle = C.text; ctx.fillText('Trainer', lx, 445);
  ctx.fillStyle = C.accent; ctx.fillText('Cycle', lx + tw, 445);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.dim; ctx.font = '500 22px ' + mono; ctx.fillText('STRUCTURED INDOOR TRAINING', W / 2, 490);

  // workout and date
  const when = new Date(ride.started_at).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  ctx.fillStyle = C.text; fitText(ctx, ride.workout_name || 'Indoor ride', W - 160, 56, '700', sans);
  ctx.fillText(ride.workout_name || 'Indoor ride', W / 2, 610);
  ctx.fillStyle = C.accent; ctx.font = '600 24px ' + sans; ctx.fillText(when.toUpperCase(), W / 2, 654);
  ctx.textAlign = 'left';

  // chart: zone-coloured targets with the power trace glowing over them, straight on the background
  const px = 80, py = 700, pw = W - 160, ph = 330, n = sec.length;
  if (n > 1){
    const maxP = Math.max(100, ...sec.map(x => Math.max(x.power || 0, x.target || 0))) * 1.1;
    const xAt = i => px + i / (n - 1) * pw;
    if (ftp){
      const bw = pw / (n - 1) + 1;
      ctx.globalAlpha = .55;
      sec.forEach((x, i) => { if (!x.target) return; const h = Math.min(ph, x.target / maxP * ph); ctx.fillStyle = zoneHex(x.target / ftp * 100); ctx.fillRect(xAt(i), py + ph - h, bw, h); });
      ctx.globalAlpha = 1;
    }
    const k = Math.max(2, Math.round(n / 600)); // smooth to roughly one point per pixel
    const sm = sec.map((x, i) => { let a = 0, c = 0; for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++){ a += sec[j].power || 0; c++; } return a / c; });
    ctx.save();
    ctx.shadowColor = 'rgba(69,214,196,.6)'; ctx.shadowBlur = 18;
    ctx.beginPath(); sm.forEach((v, i) => { const y = py + ph - v / maxP * ph; if (i) ctx.lineTo(xAt(i), y); else ctx.moveTo(xAt(i), y); });
    ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = C.line; ctx.fillRect(px, py + ph, pw, 2);

  // key stats in one row
  const stats = [
    [fmtDur(ride.duration_sec), 'Time', 1.5],
    [ride.tss, 'TSS', 0.9],
    [ride.np != null ? ride.np + ' W' : ride.avg_power != null ? ride.avg_power + ' W' : null, ride.np != null ? 'NP' : 'Avg power', 1.3],
    [ride.intensity_factor != null ? Number(ride.intensity_factor).toFixed(2) : null, 'IF', 1],
  ].filter(s => s[0] != null && s[0] !== '');
  const tot = stats.reduce((a, s) => a + s[2], 0);
  let sx = px;
  stats.forEach(([v, l, wt]) => {
    const cw = pw * wt / tot;
    ctx.fillStyle = C.text; fitText(ctx, String(v), cw - 24, 58, '700', mono); ctx.fillText(String(v), sx, 1130);
    ctx.fillStyle = C.dim; ctx.font = '600 22px ' + sans; ctx.fillText(l.toUpperCase(), sx, 1170);
    sx += cw;
  });

  // new bests, centred
  if (pbs.length){
    ctx.font = '700 22px ' + sans;
    const chips = [];
    let total = 0;
    for (const b of pbs){
      const t = 'New ' + b.label + ' best · ' + b.w + ' W', w = ctx.measureText(t).width + 32;
      if (total + w + (chips.length ? 12 : 0) > pw) break;
      chips.push([t, w]); total += w + (chips.length > 1 ? 12 : 0);
    }
    let x = (W - total) / 2;
    chips.forEach(([t, w]) => {
      roundRect(ctx, x, 1212, w, 44, 22); ctx.fillStyle = 'rgba(232,185,61,.14)'; ctx.fill(); ctx.strokeStyle = 'rgba(232,185,61,.55)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#F2CD6B'; ctx.fillText(t, x + 16, 1242);
      x += w + 12;
    });
  }

  ctx.textAlign = 'center'; ctx.fillStyle = C.dim; ctx.font = '600 24px ' + sans;
  ctx.fillText('trainercycle.com', W / 2, H - 46);
  ctx.textAlign = 'left';

  return new Promise(res => cv.toBlob(res, 'image/png'));
}

// Opens the share sheet where the device can share images (phones), otherwise downloads the PNG.
export async function shareRideImage(opts){
  const blob = await rideImageBlob(opts);
  if (!blob) throw new Error('image');
  const name = (opts.ride.workout_name || 'ride').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '-trainercycle.png';
  const file = typeof File === 'function' ? new File([blob], name, { type:'image/png' }) : null;
  const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  if (coarse && file && navigator.canShare && navigator.canShare({ files:[file] })){
    try { await navigator.share({ files:[file], title:opts.ride.workout_name || 'My ride' }); return 'shared'; }
    catch(e){ if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
