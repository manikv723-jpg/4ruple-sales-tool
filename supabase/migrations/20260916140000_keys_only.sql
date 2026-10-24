-- The 7-day free trial is gone: a licence key is the only way into the app.
-- Activation now also checks the buyer's email, and counts activations per internet connection per day.

drop table if exists public.license_trials;

-- The connection a device last checked in from, hashed. It is only for spotting a key being passed around.
alter table public.license_devices add column if not exists last_ip_hash text;

create table if not exists public.license_ip_hits (
  ip_hash text not null,
  day date not null,
  count int not null default 0,
  primary key (ip_hash, day)
);
alter table public.license_ip_hits enable row level security;

-- Raise a hand when one key is running from many places at once.
create or replace view public.licence_sharing with (security_invoker = true) as
select
  l.email,
  l.key_hint,
  l.plan,
  count(d.id) filter (where d.deactivated_at is null) as devices_in_use,
  count(distinct d.last_ip_hash) as connections_seen,
  max(d.last_seen_at) as last_seen
from public.licenses l
left join public.license_devices d on d.license_id = l.id
group by l.id
having count(distinct d.last_ip_hash) > 2
order by connections_seen desc;
