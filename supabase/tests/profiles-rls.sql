-- RLS and grants test for public.profiles.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It runs in one transaction and ends with ROLLBACK, so it leaves nothing
-- behind. Any failed check raises an exception and stops the script. On
-- success the last result row reads "profiles RLS: all checks passed".

begin;

-- 1. As postgres: the sign-up trigger creates a profile for each new user.
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated',
   'rls-test-a@example.com', '{"display_name": "  Ada  "}'),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated',
   'rls-test-b@example.com', '{}');

do $$
begin
  if (select count(*) from public.profiles
      where id in ('00000000-0000-4000-8000-00000000000a',
                   '00000000-0000-4000-8000-00000000000b')) <> 2 then
    raise exception 'trigger did not create both profiles';
  end if;
  if (select display_name from public.profiles
      where id = '00000000-0000-4000-8000-00000000000a') is distinct from 'Ada' then
    raise exception 'trigger did not copy and trim display_name';
  end if;
  if (select display_name from public.profiles
      where id = '00000000-0000-4000-8000-00000000000b') is not null then
    raise exception 'missing display_name should be null';
  end if;
end $$;

-- 2. As user A (authenticated).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);

do $$
declare
  n integer;
begin
  -- Reads only their own row.
  select count(*) into n from public.profiles;
  if n <> 1 then
    raise exception 'user A should see exactly 1 profile, saw %', n;
  end if;
  if not exists (select 1 from public.profiles
                 where id = '00000000-0000-4000-8000-00000000000a') then
    raise exception 'user A cannot see their own profile';
  end if;

  -- Cannot update another user's row (RLS filters it out: 0 rows).
  update public.profiles set display_name = 'Hacked'
  where id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'user A updated user B''s profile';
  end if;

  -- Can update their own display_name.
  update public.profiles set display_name = 'Ada L'
  where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'user A could not update their own display_name';
  end if;

  -- The display_name check constraint still applies.
  begin
    update public.profiles set display_name = ''
    where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'empty display_name was accepted';
  exception when check_violation then null;
  end;

  -- Cannot change id or created_at (no column grant).
  begin
    update public.profiles set id = '00000000-0000-4000-8000-0000000000ff'
    where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'user A changed their profile id';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set created_at = now() - interval '1 year'
    where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'user A changed created_at';
  exception when insufficient_privilege then null;
  end;

  -- Cannot insert or delete profiles (no grant, no policy).
  begin
    insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000000ff');
    raise exception 'user A inserted a profile';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.profiles where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'user A deleted their profile';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. As anon (signed out): no access at all.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

do $$
declare
  n integer;
begin
  begin
    select count(*) into n from public.profiles;
    if n <> 0 then
      raise exception 'anon can read % profiles', n;
    end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- 4. As postgres again: user B's row is untouched.
reset role;

do $$
begin
  if (select display_name from public.profiles
      where id = '00000000-0000-4000-8000-00000000000b') is not null then
    raise exception 'user B''s profile was changed';
  end if;
  raise notice 'profiles RLS: all checks passed';
end $$;

select 'profiles RLS: all checks passed' as result;

rollback;
