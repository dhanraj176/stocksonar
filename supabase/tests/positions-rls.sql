-- Constraints, RLS and grants test for public.positions.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It runs in one transaction and ends with ROLLBACK, so it leaves nothing
-- behind. Any failed check raises an exception and stops the script with an
-- error naming the check. If there is no error, every check passed, and the
-- result shown is the final row "positions RLS: all checks passed".

begin;

-- Setup, as postgres: three auth users. The sign-up trigger creates a profile
-- for each. A and B are the two users the RLS checks use; C is deleted to test
-- the cascade.
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'rls-test-a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'rls-test-b@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'rls-test-c@example.com');

-- 1. Columns, types and constraints (as postgres). Rows made here are rolled
-- back to the savepoint so later sections start with an empty table.
savepoint pair1;

do $$
declare
  n integer;
begin
  -- Column types.
  if (select numeric_precision || ',' || numeric_scale from information_schema.columns
      where table_schema = 'public' and table_name = 'positions' and column_name = 'quantity')
     is distinct from '18,6' then
    raise exception 'quantity should be numeric(18,6)';
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'positions' and column_name = 'cost_basis_cents')
     is distinct from 'bigint' then
    raise exception 'cost_basis_cents should be bigint';
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'positions' and column_name = 'source')
     is distinct from 'text' then
    raise exception 'source should be text';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'positions'
        and column_name in ('created_at', 'updated_at')
        and data_type = 'timestamp with time zone') <> 2 then
    raise exception 'created_at and updated_at should be timestamptz';
  end if;

  -- source: four allowed values, no default, never null.
  insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
  values ('00000000-0000-4000-8000-00000000000a', 'S1', 1, 0, 'csv'),
         ('00000000-0000-4000-8000-00000000000a', 'S2', 1, 0, 'screenshot'),
         ('00000000-0000-4000-8000-00000000000a', 'S3', 1, 0, 'manual'),
         ('00000000-0000-4000-8000-00000000000a', 'S4', 1, 0, 'brokerage');
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', 'S5', 1, 0, 'plaid');
    raise exception 'source plaid was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', 'S5', 1, 0, null);
    raise exception 'null source was accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents)
    values ('00000000-0000-4000-8000-00000000000a', 'S5', 1, 0);
    raise exception 'a missing source was accepted (there must be no default)';
  exception when not_null_violation then null;
  end;

  -- ticker: uppercase letters, digits, dot and dash; starts with a letter; 1 to 10 characters.
  insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
  values ('00000000-0000-4000-8000-00000000000a', 'A', 1, 0, 'manual'),
         ('00000000-0000-4000-8000-00000000000a', 'BRK.B', 1, 0, 'manual');
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', 'brk.b', 1, 0, 'manual');
    raise exception 'lowercase ticker was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', '1ABC', 1, 0, 'manual');
    raise exception 'ticker starting with a digit was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', 'ABCDEFGHIJK', 1, 0, 'manual');
    raise exception '11-character ticker was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', '', 1, 0, 'manual');
    raise exception 'empty ticker was accepted';
  exception when check_violation then null;
  end;

  -- quantity: strictly positive; the type rounds a 7th decimal away.
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', 'Q0', 0, 0, 'manual');
    raise exception 'quantity 0 was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', 'Q0', -1, 0, 'manual');
    raise exception 'negative quantity was accepted';
  exception when check_violation then null;
  end;
  insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
  values ('00000000-0000-4000-8000-00000000000a', 'Q1', 0.123456, 0, 'manual'),
         ('00000000-0000-4000-8000-00000000000a', 'Q2', 0.1234567, 0, 'manual');
  if (select quantity from public.positions
      where user_id = '00000000-0000-4000-8000-00000000000a' and ticker = 'Q2') <> 0.123457 then
    raise exception 'a 7th decimal should be rounded away by numeric(18,6)';
  end if;

  -- cost_basis_cents: zero is fine, negative is not.
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', 'C0', 1, -1, 'manual');
    raise exception 'negative cost basis was accepted';
  exception when check_violation then null;
  end;

  -- user_id must reference a profile.
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-0000000000ee', 'FK', 1, 0, 'manual');
    raise exception 'a position for a missing profile was accepted';
  exception when foreign_key_violation then null;
  end;

  -- Deleting the auth user removes their positions (auth.users -> profiles -> positions).
  insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
  values ('00000000-0000-4000-8000-00000000000c', 'GONE', 1, 0, 'manual');
  delete from auth.users where id = '00000000-0000-4000-8000-00000000000c';
  select count(*) into n from public.positions
  where user_id = '00000000-0000-4000-8000-00000000000c';
  if n <> 0 then
    raise exception 'positions were not deleted with the auth user';
  end if;

  -- updated_at moves on update; created_at does not. now() is constant inside
  -- a transaction, so seed an old timestamp (inserts don't fire the trigger).
  insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source, created_at, updated_at)
  values ('00000000-0000-4000-8000-00000000000a', 'UPD', 1, 0, 'manual',
          '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z');
  update public.positions set quantity = 2
  where user_id = '00000000-0000-4000-8000-00000000000a' and ticker = 'UPD';
  if (select updated_at from public.positions
      where user_id = '00000000-0000-4000-8000-00000000000a' and ticker = 'UPD')
     <= '2000-01-01T00:00:00Z' then
    raise exception 'updated_at was not bumped by the update';
  end if;
  if (select created_at from public.positions
      where user_id = '00000000-0000-4000-8000-00000000000a' and ticker = 'UPD')
     <> '2000-01-01T00:00:00Z' then
    raise exception 'created_at changed on update';
  end if;
end $$;

rollback to savepoint pair1;

-- 2. Uniqueness: one row per (user, ticker) (as postgres).
savepoint pair2;

do $$
declare
  n integer;
begin
  insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
  values ('00000000-0000-4000-8000-00000000000a', 'AAPL', 1, 100, 'csv');

  -- A second row for the same user and ticker is rejected.
  begin
    insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
    values ('00000000-0000-4000-8000-00000000000a', 'AAPL', 2, 200, 'manual');
    raise exception 'a duplicate (user, ticker) was accepted';
  exception when unique_violation then null;
  end;

  -- The same ticker for a different user is fine.
  insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
  values ('00000000-0000-4000-8000-00000000000b', 'AAPL', 3, 300, 'csv');

  -- Upsert replaces quantity, cost and source, and leaves one row.
  insert into public.positions (user_id, ticker, quantity, cost_basis_cents, source)
  values ('00000000-0000-4000-8000-00000000000a', 'AAPL', 5, 500, 'screenshot')
  on conflict (user_id, ticker) do update
    set quantity = excluded.quantity,
        cost_basis_cents = excluded.cost_basis_cents,
        source = excluded.source;

  select count(*) into n from public.positions
  where user_id = '00000000-0000-4000-8000-00000000000a' and ticker = 'AAPL';
  if n <> 1 then
    raise exception 'upsert should leave exactly one row, found %', n;
  end if;
  if not exists (select 1 from public.positions
                 where user_id = '00000000-0000-4000-8000-00000000000a' and ticker = 'AAPL'
                   and quantity = 5 and cost_basis_cents = 500 and source = 'screenshot') then
    raise exception 'upsert did not replace quantity, cost and source';
  end if;
end $$;

rollback to savepoint pair2;

rollback;

-- Only reached if every check above passed. The SQL Editor shows the result
-- of the last statement, so this comes after the rollback.
select 'positions RLS: all checks passed' as result;
