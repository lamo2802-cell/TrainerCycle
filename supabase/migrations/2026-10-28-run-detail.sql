-- Splits, laps and a 5-second pace / heart rate trace for runs imported from Strava, fetched by
-- strava-import ({ detail: id }) the first time the run is opened. null = not fetched yet.
-- Shape: { v:2, splits:[{d,t,hr,el,gap(cm/s)}], laps:[{d,t,e,hr,mx}], s:{ dt:5, v:[cm/s], h:[bpm], g:[grade %], c:[spm], a:[m] } | null, cad }
-- (v1 had no gap, c, a or cad; strava-import fetches those again when the run is next opened.)
alter table public.completed_rides add column if not exists run_detail jsonb;
