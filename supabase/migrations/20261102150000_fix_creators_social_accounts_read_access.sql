-- Step 5: creators and social_accounts read access.
-- Only signed-in BRAND users, admins, and the creator themself may read.
-- Another creator must not read them. Anonymous cannot read either.

-- ---------------------------------------------------------------------------
-- 1. is_brand helper: true when the caller's profile role is 'brand'
-- ---------------------------------------------------------------------------

create or replace function public.is_brand()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'brand'
  );
$$;

grant execute on function public.is_brand() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. creators: read restricted to brand users, admins, and the creator themself
-- ---------------------------------------------------------------------------

drop policy if exists creators_select on public.creators;

create policy creators_select
  on public.creators for select
  to authenticated
  using (
    public.is_admin()
    or id = auth.uid()
    or public.is_brand()
  );

-- ---------------------------------------------------------------------------
-- 3. social_accounts: read restricted to brand users, admins, and the creator themself
-- ---------------------------------------------------------------------------

drop policy if exists social_accounts_select on public.social_accounts;

create policy social_accounts_select
  on public.social_accounts for select
  to authenticated
  using (
    public.is_admin()
    or creator_id = auth.uid()
    or public.is_brand()
  );