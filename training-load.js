// Fitness / Fatigue / Form from daily TSS (exponentially weighted: 42-day and 7-day).
// Shared by calendar.html and the Today screen on index.html.
import { addDays } from './plan-schedule.js?v=6';

export const CTL_DAYS = 42, ATL_DAYS = 7;

// dailyTss: Map 'YYYY-MM-DD' -> TSS. Returns one point per day from startIso to endIso inclusive.
export function loadSeries(dailyTss, startIso, endIso, todayIso){
  let ctl = 0, atl = 0;
  const out = [];
  for (let d = startIso; d <= endIso; d = addDays(d, 1)){
    const tss = dailyTss.get(d) || 0;
    ctl += (tss - ctl) / CTL_DAYS;
    atl += (tss - atl) / ATL_DAYS;
    out.push({ date:d, tss, ctl, atl, tsb: ctl - atl, future: !!todayIso && d > todayIso });
  }
  return out;
}

// Form zones, the bands intervals.icu and others shade behind the form line.
export const FORM_ZONES = [
  { key:'transition', min:25,  max:Infinity, label:'Very fresh', color:'#d9a21b', note:'Rested for a while, fitness is starting to slip' },
  { key:'fresh',      min:5,   max:25,  label:'Fresh',      color:'#3b8fd9', note:'Good for a test, a race or a big day' },
  { key:'grey',       min:-10, max:5,   label:'Neutral',    color:'#8c97a6', note:'Not much training effect either way' },
  { key:'optimal',    min:-30, max:-10, label:'Building (tired)', color:'#2fb36d', note:'The training zone: tired enough to get fitter' },
  { key:'risk',       min:-Infinity, max:-30, label:'Very tired, ease off', color:'#e0564a', note:'High risk of overdoing it, plan some easy days' },
];
export function formZone(form){ return FORM_ZONES.find(z => form >= z.min) || FORM_ZONES[FORM_ZONES.length-1]; }
export function formLabel(form){ return formZone(form).label; }

// Ramp rate: how much Fitness rose (or fell) over the last 7 days. series from loadSeries, idx = today.
export const RAMP_FAST = 7;
export function rampRate(series, idx){
  if (!series.length) return 0;
  const i = idx == null ? series.length - 1 : idx;
  const j = Math.max(0, i - 7);
  return series[i].ctl - series[j].ctl;
}
export function rampNote(r){
  return r > RAMP_FAST ? 'Rising fast, injury and illness risk' : r >= 3 ? 'Building well' : r > 0.5 ? 'Building gently' : r >= -0.5 ? 'Holding steady' : 'Dropping';
}
