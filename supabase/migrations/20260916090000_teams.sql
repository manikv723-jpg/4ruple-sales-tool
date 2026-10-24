-- Teams for 4ruple.ai: each teammate buys their own licence and runs the app on their own laptop, and their
-- leads, drafts and activity meet here so the owner can see the day's work and nobody emails the same person twice.
-- Only the edge functions (service role) touch these tables: RLS is on with no policies.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_license_id uuid not null references public.licenses (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  license_id uuid not null references public.licenses (id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz
);
-- One seat per licence: a person can only be on one team at a time.
create unique index team_members_one_team_idx on public.team_members (license_id) where removed_at is null;

create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  code_hash text not null unique,
  created_by uuid not null references public.team_members (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.team_members (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One row per person in the team's pipeline. `data` holds the lead and its draft as the app sends it.
create table public.team_leads (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  lead_ref text not null,
  owner_member_id uuid not null references public.team_members (id) on delete cascade,
  email text not null,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- The same person is never worked twice inside one team.
create unique index team_leads_email_idx on public.team_leads (team_id, email);
create index team_leads_changed_idx on public.team_leads (team_id, updated_at);

create table public.team_events (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  member_id uuid not null references public.team_members (id) on delete cascade,
  event_ref text not null,
  type text not null,
  lead_email text,
  meta jsonb not null default '{}',
  at timestamptz not null default now()
);
-- Retries of a sync must not double count the day's work.
create unique index team_events_ref_idx on public.team_events (team_id, event_ref);
create index team_events_feed_idx on public.team_events (team_id, at);

create table public.team_blocklist (
  team_id uuid not null references public.teams (id) on delete cascade,
  value text not null,
  reason text not null default 'manual',
  by_member_id uuid references public.team_members (id) on delete set null,
  at timestamptz not null default now(),
  primary key (team_id, value)
);
create index team_blocklist_changed_idx on public.team_blocklist (team_id, at);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.team_leads enable row level security;
alter table public.team_events enable row level security;
alter table public.team_blocklist enable row level security;

-- For the dashboard: who is on which team, and how much of the pipeline they hold.
create view public.team_overview with (security_invoker = true) as
select
  t.name as team,
  m.display_name as person,
  m.role,
  l.email as licence_email,
  count(distinct tl.id) as leads_owned,
  m.last_seen_at,
  m.joined_at
from public.teams t
join public.team_members m on m.team_id = t.id and m.removed_at is null
join public.licenses l on l.id = m.license_id
left join public.team_leads tl on tl.owner_member_id = m.id
group by t.id, m.id, l.email
order by t.name, m.joined_at;
