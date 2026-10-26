// TrainerStrength shared pieces: the exercise catalogue (variations and how each one is loaded),
// the rider's equipment, logged sets (table strength_sets) and the numbers worked out from them.
//
// A workout exercise has a base key (squat, row, ...). The rider does it as one variation
// (goblet squat, barbell back squat, ...), and history is kept per variation.
// Load types: 'hand' = weight per dumbbell/kettlebell, 'total' = one weight (goblet, barbell, cable),
// 'bw' = body weight or band (reps only), 'time' = held for seconds.

export const EQUIPMENT_KEY = 'strength_equipment';
export const VARIANTS_KEY = 'strength_variants';

export const VARIANTS = {
  bw_squat:        { base:'squat', name:'Bodyweight squat', load:'bw' },
  goblet_squat:    { base:'squat', name:'Goblet squat', load:'total', equip:['dumbbell','kettlebell'] },
  db_squat:        { base:'squat', name:'Dumbbell squat', load:'hand', equip:['dumbbell'] },
  back_squat:      { base:'squat', name:'Barbell back squat', load:'total', equip:['barbell'] },
  db_rdl:          { base:'deadlift', name:'Dumbbell Romanian deadlift', load:'hand', equip:['dumbbell'] },
  kb_deadlift:     { base:'deadlift', name:'Kettlebell deadlift', load:'total', equip:['kettlebell'] },
  bb_rdl:          { base:'deadlift', name:'Barbell Romanian deadlift', load:'total', equip:['barbell'] },
  bb_deadlift:     { base:'deadlift', name:'Barbell deadlift', load:'total', equip:['barbell'] },
  knee_pushup:     { base:'pushup', name:'Knee push-up', load:'bw' },
  pushup:          { base:'pushup', name:'Push-up', load:'bw' },
  feet_up_pushup:  { base:'pushup', name:'Feet-raised push-up', load:'bw' },
  db_bench:        { base:'pushup', name:'Dumbbell bench press', load:'hand', equip:['dumbbell'] },
  db_row:          { base:'row', name:'One-arm dumbbell row', load:'hand', equip:['dumbbell'] },
  band_row:        { base:'row', name:'Band row', load:'bw', equip:['band'] },
  cable_row:       { base:'row', name:'Cable row', load:'total', equip:['cable'] },
  bb_row:          { base:'row', name:'Barbell row', load:'total', equip:['barbell'] },
  db_press:        { base:'shoulder_press', name:'Dumbbell shoulder press', load:'hand', equip:['dumbbell'] },
  kb_press:        { base:'shoulder_press', name:'Kettlebell press', load:'hand', equip:['kettlebell'] },
  bb_press:        { base:'shoulder_press', name:'Barbell overhead press', load:'total', equip:['barbell'] },
  db_curl:         { base:'bicep_curl', name:'Dumbbell curl', load:'hand', equip:['dumbbell'] },
  band_curl:       { base:'bicep_curl', name:'Band curl', load:'bw', equip:['band'] },
  cable_curl:      { base:'bicep_curl', name:'Cable curl', load:'total', equip:['cable'] },
  bw_lunge:        { base:'lunge', name:'Bodyweight lunge', load:'bw' },
  db_lunge:        { base:'lunge', name:'Dumbbell reverse lunge', load:'hand', equip:['dumbbell','kettlebell'] },
  split_squat:     { base:'lunge', name:'Bulgarian split squat', load:'hand', equip:['dumbbell','kettlebell'] },
  glute_bridge:    { base:'glute_bridge', name:'Glute bridge', load:'bw' },
  sl_glute_bridge: { base:'glute_bridge', name:'Single-leg glute bridge', load:'bw' },
  hip_thrust:      { base:'glute_bridge', name:'Hip thrust', load:'total', equip:['barbell','dumbbell'] },
  calf_raise:      { base:'calf_raise', name:'Calf raise', load:'bw' },
  db_calf_raise:   { base:'calf_raise', name:'Dumbbell calf raise', load:'hand', equip:['dumbbell'] },
  plank:           { base:'plank', name:'Plank', load:'time' },
  side_plank:      { base:'plank', name:'Side plank', load:'time' },
  mountain_climber:{ base:'mountain_climber', name:'Mountain climber', load:'bw' },
  situp:           { base:'situp', name:'Sit-up', load:'bw' },
  clamshell:       { base:'clamshell', name:'Clamshell', load:'bw' },
  hip_abduction:   { base:'standing_hip_abduction', name:'Standing hip abduction', load:'bw' },
  cable_abduction: { base:'standing_hip_abduction', name:'Cable hip abduction', load:'total', equip:['cable'] },
  straight_leg_raise:{ base:'straight_leg_raise', name:'Straight leg raise', load:'bw' },
};

// Which variation to start with when the rider hasn't chosen one, best first.
const DEFAULT_ORDER = {
  squat:['goblet_squat','back_squat','db_squat','bw_squat'],
  deadlift:['db_rdl','bb_rdl','kb_deadlift','bb_deadlift'],
  pushup:['pushup'],
  row:['db_row','cable_row','band_row','bb_row'],
  shoulder_press:['db_press','kb_press','bb_press'],
  bicep_curl:['db_curl','cable_curl','band_curl'],
  lunge:['db_lunge','bw_lunge'],
  glute_bridge:['glute_bridge'],
  calf_raise:['calf_raise'],
  plank:['plank'],
  standing_hip_abduction:['hip_abduction'],
};

// Equipment: dumbbells/kettlebells as from/to/step (kg), barbell, cable and bands as yes/no.
// Nobody has told us yet -> a well-stocked gym, so nothing is hidden.
export const GYM_EQUIPMENT = { dumbbell:{ from:2, to:50, step:2 }, kettlebell:{ from:8, to:32, step:4 }, barbell:true, cable:true, band:true, set:false };

export async function loadStrengthSettings(supabase, userId){
  const out = { equipment: GYM_EQUIPMENT, variants: {}, weightKg: null, experience: null, rideAware: true };
  try {
    const { data } = await supabase.from('settings').select('key,value').eq('user_id', userId).in('key', [EQUIPMENT_KEY, VARIANTS_KEY, 'weight_kg', 'strength_experience', 'strength_ride_aware']);
    (data || []).forEach(r => {
      const v = r.value && r.value.v;
      if (r.key === EQUIPMENT_KEY && v) out.equipment = Object.assign({}, v, { set:true });
      if (r.key === VARIANTS_KEY && v) out.variants = v;
      if (r.key === 'weight_kg' && Number(v) > 0) out.weightKg = Number(v);
      if (r.key === 'strength_experience' && v) out.experience = v;
      if (r.key === 'strength_ride_aware') out.rideAware = v !== false;
    });
  } catch(_){}
  return out;
}
export async function saveSetting(supabase, userId, key, v){
  return supabase.from('settings').upsert({ user_id:userId, key, value:{ v }, updated_at:new Date().toISOString() }, { onConflict:'user_id,key' });
}

function has(eq, type){
  const e = eq && eq[type];
  if (!e) return false;
  if (typeof e === 'object') return Number(e.to) >= Number(e.from) && Number(e.step) > 0;
  return true;
}
export function variantAvailable(id, eq){
  const v = VARIANTS[id];
  return !!v && (!v.equip || v.equip.some(t => has(eq, t)));
}
export function variantsFor(base){
  return Object.keys(VARIANTS).filter(id => VARIANTS[id].base === base);
}
// The variation to use for a workout exercise: the rider's last choice for that base key if
// they still have the kit, otherwise the first default they can do.
export function pickVariant(base, eq, chosen){
  if (chosen && chosen[base] && variantAvailable(chosen[base], eq)) return chosen[base];
  const order = (DEFAULT_ORDER[base] || []).concat(variantsFor(base));
  return order.find(id => variantAvailable(id, eq)) || variantsFor(base)[0] || null;
}

function range(r){
  const out = []; const from = Number(r.from), to = Number(r.to), step = Number(r.step);
  for (let w = from; w <= to + 1e-9 && out.length < 200; w += step) out.push(Math.round(w*100)/100);
  return out;
}
// The weights the rider can actually pick for a variation, lightest first.
export function weightOptions(id, eq){
  const v = VARIANTS[id]; if (!v || v.load === 'bw' || v.load === 'time') return [];
  const set = new Set();
  (v.equip || []).forEach(t => {
    if (!has(eq, t)) return;
    if (t === 'dumbbell' || t === 'kettlebell') range(eq[t]).forEach(w => set.add(w));
    if (t === 'barbell') range({ from:20, to:200, step:2.5 }).forEach(w => set.add(w));
    if (t === 'cable') range({ from:2.5, to:100, step:2.5 }).forEach(w => set.add(w));
  });
  return [...set].sort((a,b)=>a-b);
}
export function nearestOption(w, opts, dir){
  if (!opts.length) return w;
  if (dir === 'down'){ const d = opts.filter(o => o <= w + 1e-9); return d.length ? d[d.length-1] : opts[0]; }
  if (dir === 'up'){ const u = opts.find(o => o >= w - 1e-9); return u != null ? u : opts[opts.length-1]; }
  return opts.reduce((a,b)=>Math.abs(b-w) < Math.abs(a-w) ? b : a, opts[0]);
}

export function fmtKg(w){ return (Math.round(w*10)/10).toString().replace(/\.0$/, ''); }
export function fmtLoad(id, w){
  const v = VARIANTS[id]; if (w == null || !v) return '';
  return v.load === 'hand' ? '2 × ' + fmtKg(w) + ' kg' : fmtKg(w) + ' kg';
}
// Hold target in seconds from notes like "Hold 30-45 seconds".
export function holdTarget(notes){
  const m = /(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*sec/i.exec(notes || '');
  return m ? Number(m[2] || m[1]) : 30;
}
// Estimated one-rep max (Epley), per hand for dumbbell moves. Only for 1-12 reps, where it's reasonable.
export function e1rm(w, reps){
  if (!(w > 0) || !(reps > 0) || reps > 12) return null;
  return reps === 1 ? w : w * (1 + reps/30);
}

// Strength TSS from how hard the sets were: about 0.55 IF when every set had 4+ reps left,
// up to 0.75 when every set went to failure. No effort logged keeps the old 0.6.
export function sessionIF(sets){
  const r = sets.filter(s => s.rir != null).map(s => s.rir);
  if (!r.length) return 0.6;
  const avg = r.reduce((a,b)=>a+b,0)/r.length;
  return Math.round((0.75 - 0.05*avg)*100)/100;
}

// All logged sets for the rider, newest first, grouped by variation: { variant: [sessions] } where
// each session is { session_id, at, sets:[...] } with sets in order.
export async function loadHistory(supabase, userId, sinceDays){
  let q = supabase.from('strength_sets').select('session_id,performed_at,exercise_key,variant,set_no,weight_kg,reps,hold_sec,rir').eq('user_id', userId).order('performed_at', { ascending:false }).limit(5000);
  if (sinceDays) q = q.gte('performed_at', new Date(Date.now() - sinceDays*86400000).toISOString());
  const { data, error } = await q;
  if (error) throw error;
  const by = {};
  (data || []).forEach(s => {
    s.weight_kg = s.weight_kg == null ? null : Number(s.weight_kg);
    const list = by[s.variant] || (by[s.variant] = []);
    let sess = list.find(x => x.session_id === s.session_id);
    if (!sess){ sess = { session_id:s.session_id, at:s.performed_at, sets:[] }; list.push(sess); }
    sess.sets.push(s);
  });
  Object.values(by).forEach(list => list.forEach(sess => sess.sets.sort((a,b)=>a.set_no-b.set_no)));
  return by;
}

// Summary of one variation's history for lists and records.
export function liftSummary(id, sessions){
  const v = VARIANTS[id] || { name:id, load:'bw' };
  let best = null, top = null, last = sessions[0] || null;
  sessions.forEach(sess => sess.sets.forEach(s => {
    if (v.load === 'time'){ if (s.hold_sec && (!top || s.hold_sec > top.hold_sec)) top = Object.assign({ session_id:sess.session_id, at:sess.at }, s); return; }
    if (v.load === 'bw'){ if (s.reps && (!top || s.reps > top.reps)) top = Object.assign({ session_id:sess.session_id, at:sess.at }, s); return; }
    const e = e1rm(s.weight_kg, s.reps);
    if (e && (!best || e > best.e)) best = { e, session_id:sess.session_id, at:sess.at, set:s };
    if (s.weight_kg && (!top || s.weight_kg > top.weight_kg)) top = Object.assign({ session_id:sess.session_id, at:sess.at }, s);
  }));
  return { id, name:v.name, load:v.load, sessions:sessions.length, last, best, top };
}
export function setsText(id, sets){
  const v = VARIANTS[id] || { load:'bw' };
  if (v.load === 'time') return sets.map(s => (s.hold_sec || 0) + ' s').join(', ');
  if (v.load === 'bw') return sets.map(s => s.reps ?? '—').join(', ') + ' reps';
  const ws = [...new Set(sets.map(s => s.weight_kg))];
  if (ws.length === 1) return fmtLoad(id, ws[0]) + ' · ' + sets.map(s => s.reps ?? '—').join(', ');
  return sets.map(s => fmtKg(s.weight_kg) + '×' + (s.reps ?? '—')).join(', ') + (v.load === 'hand' ? ' (kg each)' : ' (kg)');
}

// ---- Starting weights and progression ----

// First guess at a 10-rep weight, as a share of body weight, for someone with "some experience".
// Per dumbbell for 'hand' moves. Deliberately on the light side: the first session corrects it.
const TEN_REP_RATIO = {
  goblet_squat:0.22, db_squat:0.14, back_squat:0.6,
  db_rdl:0.19, kb_deadlift:0.3, bb_rdl:0.55, bb_deadlift:0.75,
  db_bench:0.16, db_row:0.19, cable_row:0.4, bb_row:0.45,
  db_press:0.12, kb_press:0.12, bb_press:0.3,
  db_curl:0.1, cable_curl:0.15, db_lunge:0.1, split_squat:0.1,
  hip_thrust:0.6, db_calf_raise:0.15, cable_abduction:0.05,
};
const EXPERIENCE = { new:0.7, some:1, regular:1.35 };

// Weight for `reps` reps from a weight done for `fromReps` (Epley both ways).
function convertReps(w, fromReps, reps){ return w * (1 + fromReps/30) / (1 + reps/30); }

export function firstGuess(id, kit, reps){
  const ratio = TEN_REP_RATIO[id]; if (!ratio) return null;
  const opts = weightOptions(id, kit.equipment);
  const w = (kit.weightKg || 75) * ratio * (EXPERIENCE[kit.experience] || 0.85);
  return nearestOption(convertReps(w, 10, reps || 10), opts, 'down');
}

// Rep range for an exercise: its reps up to repsMax, or a sensible top if the workout gives one number.
export function repRange(ex){
  const lo = Number(ex.reps) || 8;
  const hi = Number(ex.repsMax) || (lo >= 8 ? lo + 4 : lo + 2);
  return [lo, hi];
}

// Harder version to move to once a body-weight move is easy at the top of its range.
const HARDER = { knee_pushup:'pushup', pushup:'feet_up_pushup', bw_squat:'goblet_squat', bw_lunge:'db_lunge',
  glute_bridge:'sl_glute_bridge', calf_raise:'db_calf_raise', plank:'side_plank' };

function stepUp(w, opts){ return opts.find(o => o > w + 1e-9) ?? w; }
function workingWeight(sets){ const ws = sets.map(s => s.weight_kg).filter(w => w > 0); return ws.length ? ws[ws.length-1] : null; }
const daysAgo = iso => (Date.now() - Date.parse(iso)) / 86400000;

// What to do next time for one exercise. sessions: that variation's history, newest first.
// ctx: { tired: reason string or null }. Returns { weight, reps, hold, reason, harder, calibrate }.
export function suggestNext(id, ex, sessions, kit, ctx = {}){
  const v = VARIANTS[id] || { load:'bw' };
  const [lo, hi] = repRange(ex);
  const last = sessions[0], prev = sessions[1];
  const opts = weightOptions(id, kit.equipment);
  const easy = s => s.rir == null || s.rir >= 1;
  if (v.load === 'time'){
    const target = holdTarget(ex.notes);
    if (!last) return { hold: target, reason: null };
    const best = Math.min(...last.sets.map(s => s.hold_sec || 0));
    if (best >= target && last.sets.every(easy) && !ctx.tired) return { hold: best + 5, reason: 'You held '+best+' s on every set last time, so try '+(best+5)+' s.', harder: best + 5 >= 90 ? HARDER[id] : null };
    return { hold: Math.max(target, best), reason: null };
  }
  if (v.load === 'bw'){
    if (!last) return { reps: lo, reason: null };
    const allTop = last.sets.every(s => (s.reps || 0) >= hi && easy(s));
    return { reps: lo, reason: allTop ? 'You did '+hi+'+ on every set last time.' : null, harder: allTop ? HARDER[id] : null };
  }
  // Weighted
  if (!last){
    const w = firstGuess(id, kit, lo) ?? (opts[0] ?? null);
    return { weight: w, reps: lo, calibrate: true, reason: 'First time: '+fmtLoad(id, w)+' is a starting guess. Log how many reps you had left and the next set adjusts.' };
  }
  const W = workingWeight(last.sets);
  if (W == null) return { weight: opts[0] ?? null, reps: lo, calibrate: true, reason: null };
  const repsTxt = last.sets.map(s => s.reps ?? '–').join(', ');
  const gap = daysAgo(last.at);
  if (gap > 14){
    const w = nearestOption(W * 0.9, opts, 'down');
    return { weight: w, reps: lo, reason: 'It\'s been '+Math.round(gap/7)+' weeks since last time, so starting about 10% lighter at '+fmtLoad(id, w)+'.' };
  }
  const atW = last.sets.filter(s => s.weight_kg === W);
  const allTop = atW.length && atW.every(s => (s.reps || 0) >= hi && easy(s));
  const struggled = sess => { const w = workingWeight(sess.sets); return sess.sets.filter(s => s.weight_kg === w).some(s => (s.reps || 0) < lo); };
  if (allTop){
    if (ctx.tired) return { weight: W, reps: lo, reason: ctx.tired + ', so holding at '+fmtLoad(id, W)+' today instead of going up.' };
    const up = stepUp(W, opts);
    if (up === W) return { weight: W, reps: hi, reason: 'You hit '+repsTxt+'. That\'s your heaviest weight, so aim for more reps or a slower lowering.' };
    return { weight: up, reps: lo, reason: 'You hit '+repsTxt+' at '+fmtLoad(id, W)+' last time, so up to '+fmtLoad(id, up)+'. Aim for '+lo+'+.' };
  }
  if (prev && struggled(last) && struggled(prev) && workingWeight(prev.sets) === W){
    const w = nearestOption(W * 0.9, opts, 'down');
    return { weight: w, reps: lo, reason: 'Two sessions under '+lo+' reps at '+fmtLoad(id, W)+', so dropping to '+fmtLoad(id, w)+' to build back up.' };
  }
  return { weight: W, reps: lo, reason: 'Same weight as last time ('+repsTxt+'). Aim to beat it, up to '+hi+' reps.' + (ctx.tired ? ' ' + ctx.tired + ', so leave 2 or 3 reps in the tank.' : '') };
}

// Next set within today's session, from the set just logged.
// While finding a starting weight the jumps are bigger; after that it only nudges by one step.
export function adjustNextSet(id, done, ex, kit, calibrating){
  const opts = weightOptions(id, kit.equipment);
  const [lo] = repRange(ex);
  if (done.weight == null || !opts.length) return { weight: done.weight, note: null };
  const r = done.rir, reps = done.reps || 0;
  if (calibrating){
    let f = 1;
    if (reps < lo - 1 || r === 0) f = 0.9; else if (r >= 4) f = 1.2; else if (r === 3) f = 1.1;
    if (f === 1) return { weight: done.weight, note: r == null ? null : 'That\'s about right. Stay at '+fmtLoad(id, done.weight)+'.' };
    const w = nearestOption(done.weight * f, opts, f > 1 ? 'up' : 'down');
    const moved = f > 1 ? stepUp(done.weight, opts) : w;
    const nw = f > 1 ? Math.max(w, moved) : w;
    return { weight: nw, note: nw === done.weight ? null : (f > 1 ? 'Plenty left, so try '+fmtLoad(id, nw)+'.' : 'That was tough, so try '+fmtLoad(id, nw)+'.') };
  }
  if (r != null && r >= 4 && reps >= lo){ const w = stepUp(done.weight, opts); return { weight: w, note: w === done.weight ? null : '4+ left, so try '+fmtLoad(id, w)+'.' }; }
  if (reps < lo - 2){ const d = opts.filter(o => o < done.weight - 1e-9); const w = d.length ? d[d.length-1] : done.weight; return { weight: w, note: w === done.weight ? null : 'Short of '+lo+' reps, so drop to '+fmtLoad(id, w)+'.' }; }
  return { weight: done.weight, note: null };
}

// Is the rider tired today? A hard ride in the last 24 hours, or very negative Form.
export async function tiredness(supabase, userId){
  try {
    const since = new Date(Date.now() - 90*86400000).toISOString();
    const { data } = await supabase.from('completed_rides').select('started_at,tss,intensity_factor,sport').eq('user_id', userId).gte('started_at', since);
    const rows = data || [];
    const hard = rows.find(r => r.sport !== 'strength' && daysAgo(r.started_at) <= 1 && ((r.tss || 0) >= 80 || (r.intensity_factor || 0) >= 0.85));
    if (hard) return 'You had a hard session in the last 24 hours';
    let ctl = 0, atl = 0;
    const byDay = {};
    rows.forEach(r => { const d = r.started_at.slice(0,10); byDay[d] = (byDay[d] || 0) + (r.tss || 0); });
    for (let i = 89; i >= 0; i--){ const d = new Date(Date.now() - i*86400000).toISOString().slice(0,10); const t = byDay[d] || 0; ctl += (t - ctl)/42; atl += (t - atl)/7; }
    if (ctl - atl < -30) return 'Your Form is very low';
  } catch(_){}
  return null;
}

// Swaps for when the kit's taken or something hurts: other versions of the same move first,
// then moves that work the same muscles.
const SWAP_TO = {
  squat:['lunge','glute_bridge'], lunge:['squat','glute_bridge'], deadlift:['glute_bridge','squat'], glute_bridge:['deadlift','lunge'],
  pushup:['shoulder_press'], shoulder_press:['pushup'], row:['bicep_curl'], bicep_curl:['row'],
  plank:['situp','mountain_climber'], situp:['plank','mountain_climber'], mountain_climber:['plank','situp'],
  clamshell:['standing_hip_abduction','glute_bridge'], standing_hip_abduction:['clamshell','glute_bridge'],
};
export function swapOptions(vid, base, eq){
  const bases = [base].concat(SWAP_TO[base] || []);
  return bases.flatMap(b => variantsFor(b)).filter(id => id !== vid && variantAvailable(id, eq));
}

// Barbell lifts: plates for each side of a 20 kg bar, heaviest first.
const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
export const BAR_KG = 20;
export function isBarbell(id){ const v = VARIANTS[id]; return !!v && (v.equip || []).length === 1 && v.equip[0] === 'barbell'; }
export function platesText(w){
  let side = Math.round((w - BAR_KG) / 2 * 100) / 100;
  if (side <= 0) return 'Just the bar';
  const out = [];
  PLATES.forEach(p => { while (side >= p - 1e-9){ out.push(p); side = Math.round((side - p) * 100) / 100; } });
  return out.map(p => String(p)).join(' + ') + ' each side';
}

// Warm-up sets before the first working set. Barbell lifts build up from the empty bar;
// dumbbell and kettlebell moves get one lighter set. Not logged, so they don't touch progression.
export function warmups(id, w, eq){
  const v = VARIANTS[id]; if (!v || w == null || !(v.load === 'hand' || v.load === 'total')) return [];
  const opts = weightOptions(id, eq);
  if (isBarbell(id)){
    if (w < 30) return [];
    const steps = [[0, 10], [0.5, 5], [0.7, 3]].concat(w >= 80 ? [[0.85, 2]] : []);
    const out = [];
    steps.forEach(([f, reps]) => {
      const kg = f ? Math.max(BAR_KG, nearestOption(w * f, opts, 'down')) : BAR_KG;
      if (kg < w - 1e-9 && !out.some(s => s.weight === kg)) out.push({ weight: kg, reps });
    });
    return out;
  }
  const kg = nearestOption(w * 0.5, opts, 'down');
  return kg < w - 1e-9 && w >= (v.load === 'hand' ? 8 : 12) ? [{ weight: kg, reps: 8 }] : [];
}

// Lower-body moves: these are the ones that tire legs for riding.
const LEG_BASES = new Set(['squat','deadlift','lunge','glute_bridge','calf_raise','clamshell','standing_hip_abduction','straight_leg_raise']);
export function isLegMove(base){ return LEG_BASES.has(base); }
// Share of a workout's sets that are lower body (0-1). exercises: [{ key, sets }].
export function legShare(exercises){
  let legs = 0, all = 0;
  (exercises || []).forEach(e => { const n = Number(e.sets) || 1; all += n; if (LEG_BASES.has(e.key)) legs += n; });
  return all ? legs / all : 0;
}
// A session is leg-heavy when at least 40% of its sets are lower body.
export function legHeavy(exercises){ return legShare(exercises) >= 0.4; }
// Strength TSS scale: a core or upper-body session counts 0.8x, an all-legs session 1.2x.
export function legLoadFactor(sets){
  if (!sets.length) return 1;
  const legs = sets.filter(s => LEG_BASES.has(s.base)).length;
  return Math.round((0.8 + 0.4 * legs / sets.length) * 100) / 100;
}

// A big riding week: the last 7 days' riding is well above what the rider usually does (1.3x their
// 42-day average, and at least 350 TSS), or Form is below -20. Returns a reason or null.
export async function bigRidingWeek(supabase, userId){
  try {
    const since = new Date(Date.now() - 90*86400000).toISOString();
    const { data } = await supabase.from('completed_rides').select('started_at,tss,sport').eq('user_id', userId).gte('started_at', since);
    const rows = (data || []).filter(r => r.sport !== 'strength');
    const week = rows.filter(r => daysAgo(r.started_at) <= 7).reduce((t, r) => t + (r.tss || 0), 0);
    let ctl = 0, atl = 0;
    const byDay = {};
    (data || []).forEach(r => { const d = r.started_at.slice(0,10); byDay[d] = (byDay[d] || 0) + (r.tss || 0); });
    for (let i = 89; i >= 0; i--){ const d = new Date(Date.now() - i*86400000).toISOString().slice(0,10); const t = byDay[d] || 0; ctl += (t - ctl)/42; atl += (t - atl)/7; }
    if (week >= 350 && week >= ctl * 7 * 1.3) return 'You\'ve ridden '+Math.round(week)+' TSS in the last 7 days, well above your usual week';
    if (ctl - atl < -20) return 'Your Form is '+Math.round(ctl - atl)+' after a lot of riding';
  } catch(_){}
  return null;
}
// The lighter version of a workout for a big riding week: at most 2 sets of everything.
export function lighterWorkout(exercises){
  return exercises.map(e => Object.assign({}, e, { sets: Math.min(2, e.sets) }));
}
export const RIDE_AWARE_KEY = 'strength_ride_aware';

// Muscle groups for the weekly sets chart on Progress → Strength.
const GROUP_OF = { squat:'legs', deadlift:'legs', lunge:'legs', glute_bridge:'legs', calf_raise:'legs', clamshell:'legs', standing_hip_abduction:'legs', straight_leg_raise:'legs',
  pushup:'push', shoulder_press:'push', row:'pull', bicep_curl:'pull', plank:'core', situp:'core', mountain_climber:'core' };
export function muscleGroup(base){ return GROUP_OF[base] || 'core'; }

// Body weight over time: settings key body_weight_log, [{ date:'YYYY-MM-DD', kg }] oldest first.
// Logging also updates weight_kg, which W/kg and first-guess weights use.
export const BODY_LOG_KEY = 'body_weight_log';
export async function loadBodyLog(supabase, userId){
  const { data } = await supabase.from('settings').select('value').eq('user_id', userId).eq('key', BODY_LOG_KEY).maybeSingle();
  const v = data && data.value && data.value.v;
  return Array.isArray(v) ? v.filter(e => e && e.date && Number(e.kg) > 0) : [];
}
export async function logBodyWeight(supabase, userId, kg, date){
  const log = await loadBodyLog(supabase, userId);
  const out = log.filter(e => e.date !== date).concat({ date, kg: Math.round(kg*10)/10 }).sort((a,b) => a.date < b.date ? -1 : 1).slice(-730);
  const now = new Date().toISOString();
  const r1 = await saveSetting(supabase, userId, BODY_LOG_KEY, out);
  if (r1.error) throw r1.error;
  // weight_kg follows the latest entry
  const latest = out[out.length-1];
  const r2 = await supabase.from('settings').upsert({ user_id:userId, key:'weight_kg', value:{ v: latest.kg }, updated_at:now }, { onConflict:'user_id,key' });
  if (r2.error) throw r2.error;
  return out;
}

// Is this set a new best for the variation? prev: history sessions (newest first) plus sets already
// logged today. Weighted moves compare estimated max, body-weight moves reps, holds seconds.
export function newBest(id, set, prevSessions, todaySets){
  const v = VARIANTS[id]; if (!v || !prevSessions.length) return null;
  const all = prevSessions.flatMap(s => s.sets).concat((todaySets || []).map(s => ({ weight_kg:s.weight, reps:s.reps, hold_sec:s.hold })));
  if (v.load === 'time'){ const best = Math.max(0, ...all.map(s => s.hold_sec || 0)); return set.hold > best && best > 0 ? set.hold + ' s hold' : null; }
  if (v.load === 'bw'){ const best = Math.max(0, ...all.map(s => s.reps || 0)); return set.reps > best && best > 0 ? set.reps + ' reps' : null; }
  const e = e1rm(set.weight, set.reps); if (!e) return null;
  const best = Math.max(0, ...all.map(s => e1rm(s.weight_kg, s.reps) || 0));
  return best > 0 && e > best + 0.05 ? 'estimated max ' + fmtLoad(id, Math.round(e*2)/2) : null;
}
