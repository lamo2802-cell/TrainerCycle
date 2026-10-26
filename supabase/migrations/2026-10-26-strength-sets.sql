-- Logged strength sets (applied to production 2026-10-26 as migration strength_sets).
create table public.strength_sets (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id text not null references public.completed_rides(id) on delete cascade,
  performed_at timestamptz not null default now(),
  exercise_key text not null,
  variant text not null,
  set_no int not null,
  weight_kg numeric(6,2),
  reps int,
  hold_sec int,
  rir int check (rir between 0 and 4),
  created_at timestamptz not null default now()
);
create index strength_sets_user_variant on public.strength_sets (user_id, variant, performed_at desc);
create index strength_sets_session on public.strength_sets (session_id);
alter table public.strength_sets enable row level security;
create policy "select own strength_sets" on public.strength_sets for select using (auth.uid() = user_id);
create policy "update own strength_sets" on public.strength_sets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own strength_sets" on public.strength_sets for delete using (auth.uid() = user_id);
create policy "insert strength_sets requires active subscription" on public.strength_sets for insert with check (
  auth.uid() = user_id and exists (select 1 from public.subscriptions s where s.user_id = auth.uid() and s.status in ('active','owner','trialing'))
);
