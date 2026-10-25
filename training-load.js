// Fitness / Fatigue / Form from daily TSS (exponentially weighted: 42-day and 7-day).
// Shared by calendar.html and the Today screen on index.html.
import { addDays } from './plan-schedule.js?v=1';

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

export function formLabel(form){
  return form > 5 ? 'Fresh' : form >= -10 ? 'Neutral' : form >= -30 ? 'Building (tired)' : 'Very tired, ease off';
}
