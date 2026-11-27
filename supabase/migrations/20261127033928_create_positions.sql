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
