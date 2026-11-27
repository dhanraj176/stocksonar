-- One row per stock a user holds. Money is integer cents (TOTAL cost of the
-- position, not per share); quantity may be fractional. Users can read and
-- write only their own rows. Club portfolios are out of scope here.

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  quantity numeric(18, 6) not null check (quantity > 0),
  cost_basis_cents bigint not null check (cost_basis_cents >= 0),
  source text not null check (source in ('csv', 'screenshot', 'manual', 'brokerage')), -- no default on purpose
  created_at timestamptz not null default now(), -- timestamptz is stored in UTC
  updated_at timestamptz not null default now(),
  unique (user_id, ticker) -- its index also serves the RLS filter on user_id
);

create trigger positions_set_updated_at
  before update on public.positions
  for each row execute function public.set_updated_at();

alter table public.positions enable row level security;

-- Supabase's default privileges grant everything on new tables to anon and
-- authenticated. Start from nothing and grant only what the app needs.
-- id, created_at and updated_at are never client-writable.
-- PostgREST's upsert (on conflict do update) sets every column in the
-- payload, user_id and ticker included, so those need update privilege too.
-- The update policy's with check stops anyone reassigning user_id.
revoke all on public.positions from anon, authenticated;
grant select, delete on public.positions to authenticated;
grant insert (user_id, ticker, quantity, cost_basis_cents, source)
  on public.positions to authenticated;
grant update (user_id, ticker, quantity, cost_basis_cents, source)
  on public.positions to authenticated;

create policy "positions: read own rows" on public.positions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "positions: insert own rows" on public.positions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "positions: update own rows" on public.positions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "positions: delete own rows" on public.positions
  for delete to authenticated
  using ((select auth.uid()) = user_id);
