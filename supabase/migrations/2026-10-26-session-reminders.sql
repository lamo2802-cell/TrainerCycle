-- Session reminders (send-reminders edge function).
-- Each device a rider turns reminders on for gets a row here; the function deletes rows the push service says are gone.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions select" on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "own push subscriptions insert" on public.push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own push subscriptions update" on public.push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own push subscriptions delete" on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);

-- The VAPID private key and the cron secret live in Vault (created once, outside this file):
--   select vault.create_secret('<private JWK json>', 'vapid_private_jwk');
--   select vault.create_secret('<random string>', 'reminders_cron_secret');
-- Only the service role (the edge function) can read them.
create or replace function public.reminder_secret(secret_name text) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = secret_name and name in ('vapid_private_jwk', 'reminders_cron_secret') limit 1;
$$;
revoke execute on function public.reminder_secret(text) from public, anon, authenticated;
grant execute on function public.reminder_secret(text) to service_role;

-- Every 15 minutes (reminder times are in 15-minute steps).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('send-reminders', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://uqevjhysxzkivmjwggvu.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$cron$);
