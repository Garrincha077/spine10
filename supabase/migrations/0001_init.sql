-- ASIMETRIJA — initial schema
-- Private single-user cloud sync for the planner state + the betting journal (Dnevnik).
-- Security model: every row is owned by auth.uid(); RLS lets a logged-in user touch
-- ONLY their own rows. The anon key in the client is useless without a valid session.

-- =========================================================================
-- 1) app_state : one row per user holding the whole planner config as JSON
--    (principal, rate, lanes A–D, cadence, builder, mt, budget — everything
--     in the app's state object S EXCEPT the journal/log, which lives in `tickets`).
-- =========================================================================
create table if not exists public.app_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "app_state owner read"   on public.app_state;
drop policy if exists "app_state owner write"  on public.app_state;
drop policy if exists "app_state owner modify" on public.app_state;
drop policy if exists "app_state owner delete" on public.app_state;

create policy "app_state owner read"   on public.app_state for select using (auth.uid() = user_id);
create policy "app_state owner write"  on public.app_state for insert with check (auth.uid() = user_id);
create policy "app_state owner modify" on public.app_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "app_state owner delete" on public.app_state for delete using (auth.uid() = user_id);

-- keep updated_at fresh on every change (used for last-write-wins between devices)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch before update on public.app_state
  for each row execute function public.touch_updated_at();

-- =========================================================================
-- 2) tickets : the journal (Dnevnik). One row per saved acca/ticket.
--    Read+written by BOTH the web app AND Claude on desktop (via Supabase MCP),
--    so "daj listić" in chat appears in the app.
-- =========================================================================
create table if not exists public.tickets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  label      text        not null default '',
  lane       text        not null default 'A' check (lane in ('A','B','C','D')),
  stake      numeric     not null default 0,
  mult       numeric     not null default 0,   -- total multiplier (product of legs)
  pay        numeric     not null default 0,   -- net payout if it wins
  tp         numeric     not null default 0,   -- "true" probability estimate
  status     text        not null default 'pending' check (status in ('pending','win','loss')),
  skimmed    boolean     not null default false, -- flywheel: 50% of a big win moved to principal
  placed_on  date        not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists tickets_user_created_idx on public.tickets (user_id, created_at desc);

alter table public.tickets enable row level security;

drop policy if exists "tickets owner read"   on public.tickets;
drop policy if exists "tickets owner write"  on public.tickets;
drop policy if exists "tickets owner modify" on public.tickets;
drop policy if exists "tickets owner delete" on public.tickets;

create policy "tickets owner read"   on public.tickets for select using (auth.uid() = user_id);
create policy "tickets owner write"  on public.tickets for insert with check (auth.uid() = user_id);
create policy "tickets owner modify" on public.tickets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tickets owner delete" on public.tickets for delete using (auth.uid() = user_id);

-- =========================================================================
-- 3) realtime : let the app receive live inserts/updates (chat adds a ticket
--    on desktop -> it pops into the app without a refresh).
-- =========================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
  ) then
    execute 'alter publication supabase_realtime add table public.tickets';
  end if;
end $$;
