-- Splits, laps and a 5-second pace / heart rate trace for runs imported from Strava, fetched by
-- strava-import ({ detail: id }) the first time the run is opened. null = not fetched yet.
-- Shape: { v:1, splits:[{d,t,hr,el}], laps:[{d,t,e,hr,mx}], s:{ dt:5, v:[cm/s], h:[bpm], g:[grade %] } | null }
alter table public.completed_rides add column if not exists run_detail jsonb;
