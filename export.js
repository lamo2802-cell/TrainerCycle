// Workout files for other devices and apps:
//   .FIT workout  - Garmin, Wahoo, Hammerhead, intervals.icu, TrainingPeaks (bike and run)
//   .ZWO          - Zwift (bike only)
// Bike targets go out as % of FTP so the device scales them to the rider's own FTP; watt steps are
// converted with the FTP given. Runs go out with pace ranges (as speed) from the threshold pace.
import { showSheet } from './sheet.js?v=3';
import { zonePaces } from './run.js?v=8';

// ---- FIT encoding (little endian, protocol 1.0) ----
const CRC_TABLE = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];
function crc16(bytes, crc = 0){
  for (const b of bytes){
    let t = CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ t ^ CRC_TABLE[b & 0xF];
    t = CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ t ^ CRC_TABLE[(b >> 4) & 0xF];
  }
  return crc;
}
const T_ENUM = 0x00, T_U16 = 0x84, T_U32 = 0x86, T_U32Z = 0x8C, T_STR = 0x07;
const SIZE = { [T_ENUM]:1, [T_U16]:2, [T_U32]:4, [T_U32Z]:4 };
const INVALID = { [T_ENUM]:0xFF, [T_U16]:0xFFFF, [T_U32]:0xFFFFFFFF, [T_U32Z]:0 };
const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in unix seconds

class FitWriter {
  constructor(){ this.bytes = []; this.local = 0; }
  // fields: [[fieldNum, baseType, size?]] ; returns the local message type to write records with
  define(globalNum, fields){
    const local = this.local++;
    this.bytes.push(0x40 | local, 0, 0, globalNum & 0xFF, globalNum >> 8, fields.length);
    for (const [num, type, size] of fields) this.bytes.push(num, size || SIZE[type], type);
    return { local, fields };
  }
  write(def, values){
    this.bytes.push(def.local);
    def.fields.forEach(([, type, size], i) => {
      let v = values[i];
      if (type === T_STR){
        const enc = new TextEncoder().encode(String(v || '')).slice(0, size - 1);
        for (let k = 0; k < size; k++) this.bytes.push(k < enc.length ? enc[k] : 0);
        return;
      }
      if (v == null || !isFinite(v)) v = INVALID[type];
      v = Math.max(0, Math.round(v));
      for (let k = 0; k < SIZE[type]; k++) this.bytes.push((v >>> (8*k)) & 0xFF);
    });
  }
  finish(){
    const data = this.bytes, len = data.length;
    const head = [14, 0x10, 0x54, 0x08, len & 0xFF, (len >> 8) & 0xFF, (len >> 16) & 0xFF, (len >>> 24) & 0xFF, 0x2E, 0x46, 0x49, 0x54]; // profile 21.32, ".FIT"
    const hc = crc16(head); head.push(hc & 0xFF, hc >> 8);
    const dc = crc16(data, crc16(head));
    return new Uint8Array(head.concat(data, [dc & 0xFF, dc >> 8]));
  }
}

// steps: [{ name, secs?, metres?, target:{ kind:'power'|'hr_pct'|'hr_bpm'|'speed'|'open', low, high }, intensity, repeatFrom?, reps? }]
// A step with repeatFrom/reps is a "repeat steps from index N, reps times" marker.
function fitWorkout(name, sport, steps){
  const w = new FitWriter();
  const fileId = w.define(0, [[0, T_ENUM], [1, T_U16], [2, T_U16], [3, T_U32Z], [4, T_U32]]);
  w.write(fileId, [5, 255, 0, Math.floor(Math.random()*0xFFFFFFF) + 1, Math.floor(Date.now()/1000) - FIT_EPOCH]);
  const wkt = w.define(26, [[4, T_ENUM], [6, T_U16], [8, T_STR, 32]]);
  w.write(wkt, [sport, steps.length, name]);
  const st = w.define(27, [[254, T_U16], [0, T_STR, 24], [1, T_ENUM], [2, T_U32], [3, T_ENUM], [4, T_U32], [5, T_U32], [6, T_U32], [7, T_ENUM]]);
  steps.forEach((s, i) => {
    if (s.reps){ w.write(st, [i, '', 6, s.repeatFrom, 2, s.reps, null, null, null]); return; }
    const durType = s.metres ? 1 : s.secs ? 0 : 5;
    const durVal = s.metres ? s.metres * 100 : s.secs ? s.secs * 1000 : null;
    const t = s.target || { kind:'open' };
    const TT = { power:4, hr_pct:1, hr_bpm:1, speed:0, open:2 }[t.kind];
    let lo = null, hi = null;
    if (t.kind === 'power'){ lo = t.low; hi = t.high; }          // 0-1000 = % FTP
    else if (t.kind === 'hr_pct'){ lo = t.low; hi = t.high; }    // 0-100 = % max HR
    else if (t.kind === 'hr_bpm'){ lo = t.low + 100; hi = t.high + 100; }
    else if (t.kind === 'speed'){ lo = t.low * 1000; hi = t.high * 1000; } // mm/s
    w.write(st, [i, s.name, durType, durVal, TT, t.kind === 'open' ? null : 0, lo, hi, s.intensity]);
  });
  return w.finish();
}

// ---- bike workouts (TrainerCycle steps: { type:'step', duration, targetType, low, high, note } | { type:'repeat', repetitions, steps }) ----
function bikeTarget(s, ftp){
  if (s.targetType === 'ftp_pct') return { kind:'power', low:s.low, high:s.high };
  if (s.targetType === 'watts' && ftp) return { kind:'power', low:Math.round(s.low/ftp*100), high:Math.round(s.high/ftp*100) };
  if (s.targetType === 'hr_pct') return { kind:'hr_pct', low:s.low, high:s.high };
  if (s.targetType === 'hr_bpm') return { kind:'hr_bpm', low:s.low, high:s.high };
  return { kind:'open' };
}
function bikeIntensity(s, i, n, ftp){
  const pct = s.targetType === 'ftp_pct' ? (s.low + s.high)/2 : s.targetType === 'watts' && ftp ? (s.low + s.high)/2/ftp*100 : 100;
  if (i === 0 && pct < 70) return 2;          // warmup
  if (i === n - 1 && pct < 70) return 3;      // cooldown
  return pct < 60 ? 1 : 0;                    // rest : active
}
function flattenBike(steps){ let out = []; for (const s of steps || []){ if (s.type === 'repeat'){ for (let i = 0; i < s.repetitions; i++) out = out.concat(flattenBike(s.steps)); } else out.push(s); } return out; }

export function workoutToFit(w, ftp){
  const top = w.steps || [];
  const n = top.length, out = [];
  const one = (s, i) => ({ name: s.note || '', secs: Math.round(s.duration || 0), target: bikeTarget(s, ftp), intensity: bikeIntensity(s, i, n, ftp) });
  top.forEach((s, i) => {
    if (s.type === 'repeat' && s.steps.every(c => c.type !== 'repeat') && s.repetitions > 1){
      const from = out.length;
      s.steps.forEach(c => out.push(one(c, -1)));
      out.push({ repeatFrom: from, reps: s.repetitions });
    } else {
      (s.type === 'repeat' ? flattenBike([s]) : [s]).forEach(c => out.push(one(c, i)));
    }
  });
  return fitWorkout(w.name || 'TrainerCycle workout', 2, out);
}

const xml = s => String(s || '').replace(/[<>&"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]));
export function workoutToZwo(w, ftp){
  const frac = s => {
    if (s.targetType === 'ftp_pct') return ((s.low + s.high)/200).toFixed(3);
    if (s.targetType === 'watts' && ftp) return ((s.low + s.high)/2/ftp).toFixed(3);
    return null;
  };
  const step = s => {
    const d = Math.round(s.duration || 0), p = frac(s);
    const text = s.note ? '<textevent timeoffset="0" message="'+xml(s.note)+'"/>' : '';
    return p == null ? '    <FreeRide Duration="'+d+'">'+text+'</FreeRide>\n' : '    <SteadyState Duration="'+d+'" Power="'+p+'">'+text+'</SteadyState>\n';
  };
  let body = '';
  for (const s of w.steps || []){
    const kids = s.type === 'repeat' ? s.steps : null;
    // Zwift's IntervalsT is an on/off pair repeated; anything else is written out step by step
    if (kids && kids.length === 2 && kids.every(k => k.type !== 'repeat' && frac(k) != null)){
      body += '    <IntervalsT Repeat="'+s.repetitions+'" OnDuration="'+Math.round(kids[0].duration)+'" OffDuration="'+Math.round(kids[1].duration)
        + '" OnPower="'+frac(kids[0])+'" OffPower="'+frac(kids[1])+'"/>\n';
    } else (kids ? flattenBike([s]) : [s]).forEach(k => { body += step(k); });
  }
  return '<workout_file>\n  <author>TrainerCycle</author>\n  <name>'+xml(w.name)+'</name>\n  <description>'+xml(w.description || 'From TrainerCycle')+'</description>\n'
    + '  <sportType>bike</sportType>\n  <tags/>\n  <workout>\n' + body + '  </workout>\n</workout_file>\n';
}

// ---- runs (run.js sessions: { mins | secs | km, zone, reps?, rec?, IF? }) ----
export function runToFit(session, T){
  const speedFor = st => {
    let p = null;
    if (st.zone === 'race'){ const g = T && st.IF ? T / st.IF : null; p = g ? [Math.round(g*0.98), Math.round(g*1.02)] : null; }
    else p = zonePaces(st.zone, T);
    return p ? { kind:'speed', low: 1000 / p[1], high: 1000 / p[0] } : { kind:'open' }; // slower pace = lower speed
  };
  const len = st => st.km ? { metres: Math.round(st.km*1000) } : { secs: Math.round(st.mins ? st.mins*60 : st.secs || 0) };
  const out = [];
  (session.steps || []).forEach((st, i) => {
    const name = st.zone === 'race' ? 'Race' : st.zone.charAt(0).toUpperCase() + st.zone.slice(1);
    const work = Object.assign({ name, target: speedFor(st), intensity: st.zone === 'easy' ? (i === 0 ? 2 : 0) : 0 }, len(st));
    if (st.reps && st.reps > 1){
      const from = out.length;
      out.push(work);
      if (st.rec) out.push(Object.assign({ name: st.rec.kind === 'walk' ? 'Walk' : 'Jog', target:{ kind:'open' }, intensity:1 }, len(st.rec)));
      out.push({ repeatFrom: from, reps: st.reps });
    } else out.push(work);
  });
  return fitWorkout(session.name || 'TrainerRun session', 1, out);
}

// ---- download + the "send to a device" sheet ----
function slug(s){ return String(s || 'workout').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'workout'; }
export function download(data, filename, type){
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// kind 'bike' (workout + ftp) or 'run' (run session + threshold pace T)
export function openExportSheet({ kind = 'bike', workout, ftp, session, T } = {}){
  const name = kind === 'run' ? session.name : workout.name;
  const box = document.createElement('div');
  box.className = 'tc-export';
  box.innerHTML = '<style>.tc-export .ex-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:12px 14px;margin:0 0 8px;border-radius:10px;background:var(--panel-2,#1B212A);color:var(--text,#E6EAF0);border:1px solid var(--line,#2A313B);cursor:pointer;font-family:inherit}.tc-export .ex-opt:hover{border-color:var(--accent,#3DD6B5)}'
    + '.tc-export .ex-opt b{font-size:14.5px}.tc-export .ex-opt span{font-size:12.5px;color:var(--text-dim,#8a94a3);font-weight:400}'
    + '.tc-export .ex-help{font-size:12.5px;color:var(--text-dim,#8a94a3);margin:6px 0 0;line-height:1.5}</style>'
    + '<button class="ex-opt" data-ex="fit"><b>Garmin, Wahoo and other devices (.FIT)</b><span>'+(kind === 'run' ? 'Paces from your threshold pace' : 'Targets as % of FTP, so your device uses its own FTP')+'</span></button>'
    + (kind === 'bike' ? '<button class="ex-opt" data-ex="zwo"><b>Zwift (.ZWO)</b><span>Shows up under Custom Workouts</span></button>' : '')
    + '<p class="ex-help"><b>Garmin:</b> plug the device in and copy the .FIT file into its Garmin/NewFiles folder. '
    + '<b>Wahoo, Garmin over the air, and other apps:</b> import the file at intervals.icu or TrainingPeaks, which sync it to your device. '
    + (kind === 'bike' ? '<b>Zwift:</b> put the .ZWO file in Documents/Zwift/Workouts/&lt;your number&gt;, then it\'s under Custom Workouts.' : '')+'</p>';
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-ex]');
    if (!b) return;
    if (b.dataset.ex === 'zwo') download(workoutToZwo(workout, ftp), slug(name)+'.zwo', 'application/xml');
    else download(kind === 'run' ? runToFit(session, T) : workoutToFit(workout, ftp), slug(name)+'.fit', 'application/octet-stream');
  });
  return showSheet({ title:'Download "'+name+'"', content: box, buttons:[{ label:'Done', value:true }] });
}
