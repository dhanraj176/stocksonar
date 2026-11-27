-- Shared trigger function: stamps updated_at on every update. Attach it with
-- a "before update" trigger on any table that has an updated_at column.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Only triggers should run this function.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
