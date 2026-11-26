-- One profile row per auth user. Created by a trigger on sign-up and removed
-- with the user. Users can read and update only their own row.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 50),
  created_at timestamptz not null default now() -- timestamptz is stored in UTC
);

alter table public.profiles enable row level security;

-- Supabase's default privileges grant everything on new tables to anon and
-- authenticated. Start from nothing and grant only what the app needs.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated; -- id and created_at can't change

create policy "profiles: read own row" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: update own row" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No insert or delete policies: rows are created by the trigger below and
-- removed by the cascade when the auth user is deleted. anon has no grant
-- and no policy, so signed-out requests see nothing.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''));
  return new;
end;
$$;

-- Only the trigger should run this function.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
