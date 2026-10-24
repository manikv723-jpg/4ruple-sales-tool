-- 4ruple.ai licenses.
-- Only the edge functions (service role) read or write these tables. Row level security is on with no
-- policies, so the public anon key can't see or change anything.

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,            -- sha256 of the key; the key itself is only in the buyer's email
  key_hint text not null,                   -- last 5 characters, to find a license when someone writes in
  email text not null,
  plan text not null default 'lifetime',
  max_devices int not null default 2 check (max_devices between 1 and 20),
  status text not null default 'active' check (status in ('active', 'revoked', 'refunded')),
  provider text not null default 'manual',  -- razorpay, manual, ...
  order_ref text unique,                    -- payment id from the provider, so webhook retries don't double-issue
  amount_paise int,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index licenses_email_idx on public.licenses (lower(email));

create table public.license_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses (id) on delete cascade,
  device_hash text not null,                -- sha256 of the machine id, never the id itself
  device_name text,
  platform text,
  app_version text,
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deactivated_at timestamptz,
  unique (license_id, device_hash)
);

create table public.license_events (
  id bigint generated always as identity primary key,
  license_id uuid not null references public.licenses (id) on delete cascade,
  type text not null,                       -- issue, reissue, activate, deactivate, refund
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index license_events_lookup_idx on public.license_events (license_id, type, created_at);

-- One 7-day free trial per device, started on first run with no key and no card.
create table public.license_trials (
  device_hash text primary key,
  device_name text,
  platform text,
  app_version text,
  started_at timestamptz not null default now()
);

alter table public.license_trials enable row level security;
alter table public.licenses enable row level security;
alter table public.license_devices enable row level security;
alter table public.license_events enable row level security;

-- For the Supabase dashboard: every sale and how many devices it's on.
create view public.license_overview with (security_invoker = true) as
select
  l.email,
  l.key_hint,
  l.status,
  l.provider,
  l.order_ref,
  l.amount_paise / 100.0 as amount_inr,
  count(d.id) filter (where d.deactivated_at is null) as devices_in_use,
  l.max_devices,
  l.email_sent_at is not null as key_emailed,
  l.created_at
from public.licenses l
left join public.license_devices d on d.license_id = l.id
group by l.id
order by l.created_at desc;
