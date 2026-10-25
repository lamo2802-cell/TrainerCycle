// Shareable ride card: the ride chart, key stats and the TrainerCycle logo as a 1080x1350 PNG (4:5, the
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

function loadImg(src){
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
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

// ride: completed_rides row. sec: per-second samples ({power, hr, target}). ftp: FTP at the time. pbs: [{label, w}].
export async function rideImageBlob({ ride, sec, ftp, pbs = [] }){
  const sans = "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";
  try { await Promise.all(['700 64px Inter', '600 28px Inter', '700 52px "JetBrains Mono"'].map(f => document.fonts.load(f))); } catch(_){}
  const [photo, logo] = await Promise.all([loadImg('banner-rides.jpg'), loadImg('wordmark.svg')]);

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  // photo across the top, fading into the background
  if (photo){
    const ph = 560, scale = Math.max(W / photo.width, ph / photo.height);
    const dw = photo.width * scale, dh = photo.height * scale;
    ctx.globalAlpha = .7; ctx.drawImage(photo, (W - dw) / 2, (ph - dh) / 2, dw, dh); ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, 0, 0, ph);
    g.addColorStop(0, 'rgba(16,20,26,.55)'); g.addColorStop(.55, 'rgba(16,20,26,.35)'); g.addColorStop(1, C.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, ph);
  }
  if (logo){ const lh = 84; ctx.drawImage(logo, 64, 56, lh * logo.width / logo.height, lh); }

  // title
  const when = new Date(ride.started_at).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  ctx.fillStyle = C.accent; ctx.font = '700 26px ' + sans; ctx.textBaseline = 'alphabetic';
  ctx.fillText(((ride.completed ? 'WORKOUT COMPLETE' : 'INDOOR RIDE') + ' · ' + when).toUpperCase(), 64, 340);
  ctx.fillStyle = C.text;
  fitText(ctx, ride.workout_name || 'Indoor ride', W - 128, 72, '700', sans);
  ctx.fillText(ride.workout_name || 'Indoor ride', 64, 420);

  // chart
  const cx = 64, cy = 470, cw = W - 128, ch = 360;
  roundRect(ctx, cx, cy, cw, ch, 24); ctx.fillStyle = C.panel; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
  const px = cx + 28, py = cy + 28, pw = cw - 56, phh = ch - 56, n = sec.length;
  if (n > 1){
    const maxP = Math.max(100, ...sec.map(x => Math.max(x.power || 0, x.target || 0))) * 1.12;
    const maxHr = Math.max(60, ...sec.map(x => x.hr || 0)) * 1.1;
    const xAt = i => px + i / (n - 1) * pw;
    if (ftp){
      const bw = pw / (n - 1) + 1;
      ctx.globalAlpha = .45;
      sec.forEach((x, i) => { if (!x.target) return; const h = Math.min(phh, x.target / maxP * phh); ctx.fillStyle = zoneHex(x.target / ftp * 100); ctx.fillRect(xAt(i), py + phh - h, bw, h); });
      ctx.globalAlpha = 1;
    }
    const line = (vals, max, color, lw) => {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
      let on = false;
      vals.forEach((v, i) => { if (v == null){ on = false; return; } const y = py + phh - v / max * phh; if (!on){ ctx.moveTo(xAt(i), y); on = true; } else ctx.lineTo(xAt(i), y); });
      ctx.stroke();
    };
    const k = Math.max(2, Math.round(n / 600)); // smooth to roughly one point per pixel
    const sm = sec.map((x, i) => { let a = 0, c = 0; for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++){ a += sec[j].power || 0; c++; } return a / c; });
    if (sec.some(x => x.hr)) line(sec.map(x => x.hr || null), maxHr, 'rgba(229,72,77,.85)', 2.5);
    line(sm, maxP, C.accent, 4);
  }

  // stats
  const kj = ride.avg_power != null ? Math.round(ride.avg_power * ride.duration_sec / 1000) : null;
  const stats = [
    [fmtDur(ride.duration_sec), 'Time'],
    [ride.tss, 'TSS'],
    [ride.np != null ? ride.np + ' W' : null, 'Normalized power'],
    [ride.avg_power != null ? ride.avg_power + ' W' : null, 'Avg power'],
    [ride.intensity_factor != null ? Number(ride.intensity_factor).toFixed(2) : null, 'Intensity'],
    [ride.avg_hr ? ride.avg_hr + ' bpm' : kj != null ? kj + ' kJ' : null, ride.avg_hr ? 'Avg heart rate' : 'Work'],
  ].filter(s => s[0] != null && s[0] !== '').slice(0, 6);
  const cols = 3, gx = 64, gy = 870, gw = (W - 128 - 2 * 20) / cols, gh = 132;
  stats.forEach(([v, l], i) => {
    const x = gx + (i % cols) * (gw + 20), y = gy + Math.floor(i / cols) * (gh + 20);
    roundRect(ctx, x, y, gw, gh, 20); ctx.fillStyle = C.panel; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = C.text; fitText(ctx, String(v), gw - 48, 52, '700', mono); ctx.fillText(String(v), x + 24, y + 70);
    ctx.fillStyle = C.dim; ctx.font = '600 24px ' + sans; ctx.fillText(l.toUpperCase(), x + 24, y + 108);
  });

  // personal bests, or the footer line
  let fy = gy + Math.ceil(stats.length / cols) * (gh + 20) + 18;
  if (pbs.length){
    ctx.font = '700 24px ' + sans;
    let x = 64;
    for (const b of pbs.slice(0, 3)){
      const t = 'New ' + b.label + ' best · ' + b.w + ' W', tw = ctx.measureText(t).width + 36;
      if (x + tw > W - 64) break;
      roundRect(ctx, x, fy, tw, 48, 24); ctx.fillStyle = 'rgba(232,185,61,.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(232,185,61,.6)'; ctx.stroke();
      ctx.fillStyle = '#F2CD6B'; ctx.fillText(t, x + 18, fy + 33);
      x += tw + 12;
    }
  }
  ctx.fillStyle = C.dim; ctx.font = '600 26px ' + sans; ctx.textAlign = 'right';
  ctx.fillText('Trained with TrainerCycle · trainercycle.com', W - 64, H - 52);
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
