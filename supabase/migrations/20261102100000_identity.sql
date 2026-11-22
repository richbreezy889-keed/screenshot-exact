-- Step 2: identity, access rules and brand/creator profiles.
-- Money is never stored here. Timestamps are UTC timestamptz.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('admin', 'brand', 'creator');
create type public.member_role as enum ('owner', 'manager', 'viewer');
create type public.social_platform as enum (
  'tiktok',
  'instagram',
  'youtube',
  'x',
  'facebook',
  'other'
);

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_settings: exactly one row, seeded.
-- ---------------------------------------------------------------------------

create table public.platform_settings (
  id boolean primary key default true,
  constraint platform_settings_single_row check (id),
  platform_name text not null default 'Biboh',
  support_email text,
  default_currency text not null default 'TZS',
  -- Fee in basis points so no floating point money is involved.
  platform_fee_bps integer not null default 2000
    check (platform_fee_bps between 0 and 10000),
  min_payout_tzs bigint not null default 0
    check (min_payout_tzs >= 0),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (true);

create trigger platform_settings_touch_updated_at
before update on public.platform_settings
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'creator',
  full_name text,
  email text,
  phone text,
  avatar_url text,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

-- Reads the caller's profile without being blocked by profiles RLS.
create or replace function public.is_admin()
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
      and p.role = 'admin'
  );
$$;

create or replace function public.is_creator()
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
      and p.role = 'creator'
  );
$$;

-- Signup hook: create the profile row. Only "brand" and "creator" may be
-- requested through signup metadata; every other value (including admin)
-- falls back to creator so nobody can self-register as an admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
begin
  requested_role := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'creator');
  if requested_role not in ('brand', 'creator') then
    requested_role := 'creator';
  end if;

  insert into public.profiles (id, role, full_name, email)
  values (
    new.id,
    requested_role::public.user_role,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    ),
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Users may edit their own profile, but never their own role or the
-- phone-verified flag. Admins and the service role may.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'profiles.role can only be changed by an admin'
      using errcode = 'insufficient_privilege';
  end if;

  if new.phone_verified_at is distinct from old.phone_verified_at then
    raise exception 'profiles.phone_verified_at can only be changed by an admin'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger profiles_protect_fields
before update on public.profiles
for each row execute function public.protect_profile_fields();

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  logo_url text,
  website text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index brands_created_by_idx on public.brands (created_by);

create trigger brands_touch_updated_at
before update on public.brands
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- brand_members
-- ---------------------------------------------------------------------------

create table public.brand_members (
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'viewer',
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);

-- Membership helpers read brand_members directly and bypass its RLS, which
-- keeps the policies below from recursing.
create or replace function public.is_brand_member(target_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.brand_members m
    where m.brand_id = target_brand_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.brand_role(target_brand_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.brand_members m
  where m.brand_id = target_brand_id
    and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_manage_brand(target_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.brand_role(target_brand_id) in ('owner', 'manager');
$$;

-- True when the caller and target_user_id share at least one brand.
create or replace function public.shares_brand_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.brand_members me
    join public.brand_members them on them.brand_id = me.brand_id
    where me.user_id = auth.uid()
      and them.user_id = target_user_id
  );
$$;

-- A brand has at most one owner.
create unique index brand_members_one_owner_idx
  on public.brand_members (brand_id)
  where role = 'owner';

create index brand_members_user_id_idx on public.brand_members (user_id);
create index brand_members_invited_by_idx on public.brand_members (invited_by);

create trigger brand_members_touch_updated_at
before update on public.brand_members
for each row execute function public.touch_updated_at();

-- The owner membership is permanent while the brand exists. Deleting the
-- brand itself is allowed: the parent row is already gone when the cascade
-- reaches this trigger.
create or replace function public.protect_brand_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner'
      and exists (select 1 from public.brands b where b.id = old.brand_id)
    then
      raise exception 'the brand owner cannot be removed'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if new.brand_id is distinct from old.brand_id
    or new.user_id is distinct from old.user_id
  then
    raise exception 'brand membership identity cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  if old.role = 'owner' and new.role is distinct from old.role then
    raise exception 'the brand owner cannot be demoted'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger brand_members_protect_owner
before update or delete on public.brand_members
for each row execute function public.protect_brand_owner();

-- Creates a brand and makes the caller its owner atomically.
create or replace function public.create_brand(brand_name text)
returns public.brands
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  created public.brands;
begin
  if caller is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = caller
      and p.role in ('brand', 'admin')
  ) then
    raise exception 'only brand accounts can create brands'
      using errcode = 'insufficient_privilege';
  end if;

  if brand_name is null or char_length(btrim(brand_name)) < 2 then
    raise exception 'brand name must be at least 2 characters'
      using errcode = 'check_violation';
  end if;

  insert into public.brands (name, created_by)
  values (btrim(brand_name), caller)
  returning * into created;

  insert into public.brand_members (brand_id, user_id, role)
  values (created.id, caller, 'owner');

  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- creators
-- ---------------------------------------------------------------------------

create table public.creators (
  id uuid primary key references public.profiles (id) on delete cascade,
  display_name text not null default 'Creator'
    check (char_length(btrim(display_name)) between 1 and 120),
  handle text,
  bio text,
  niche text,
  location text,
  avatar_url text,
  rating numeric(2, 1) not null default 0
    check (rating >= 0 and rating <= 5),
  past_campaigns integer not null default 0
    check (past_campaigns >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger creators_touch_updated_at
before update on public.creators
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- social_accounts
-- ---------------------------------------------------------------------------

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  platform public.social_platform not null,
  handle text not null check (char_length(btrim(handle)) between 1 and 120),
  profile_url text,
  followers bigint not null default 0 check (followers >= 0),
  avg_views bigint not null default 0 check (avg_views >= 0),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, platform, handle)
);

create index social_accounts_creator_id_idx on public.social_accounts (creator_id);

create trigger social_accounts_touch_updated_at
before update on public.social_accounts
for each row execute function public.touch_updated_at();

-- Followers/views are creator-editable, verification is not.
create or replace function public.protect_social_account_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verified_at is not null then
      raise exception 'social account verification is admin-only'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.verified_at is distinct from old.verified_at then
    raise exception 'social account verification is admin-only'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger social_accounts_protect_verification
before insert or update on public.social_accounts
for each row execute function public.protect_social_account_verification();

-- ---------------------------------------------------------------------------
-- Row level security: deny by default, then explicit policies.
-- ---------------------------------------------------------------------------

alter table public.platform_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.brand_members enable row level security;
alter table public.creators enable row level security;
alter table public.social_accounts enable row level security;

-- platform_settings: world-readable reference data, admin-writable.
create policy platform_settings_select
  on public.platform_settings for select
  to anon, authenticated
  using (true);

create policy platform_settings_insert
  on public.platform_settings for insert
  to authenticated
  with check (public.is_admin());

create policy platform_settings_update
  on public.platform_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy platform_settings_delete
  on public.platform_settings for delete
  to authenticated
  using (public.is_admin());

-- profiles: self, admins, and brand teammates.
create policy profiles_select
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.shares_brand_with(id)
  );

create policy profiles_insert_admin
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

create policy profiles_update
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy profiles_delete_admin
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- brands: visible to members, managed by owner/manager.
create policy brands_select
  on public.brands for select
  to authenticated
  using (public.is_admin() or public.is_brand_member(id));

create policy brands_insert_admin
  on public.brands for insert
  to authenticated
  with check (public.is_admin());

create policy brands_update
  on public.brands for update
  to authenticated
  using (public.is_admin() or public.can_manage_brand(id))
  with check (public.is_admin() or public.can_manage_brand(id));

create policy brands_delete
  on public.brands for delete
  to authenticated
  using (public.is_admin() or public.brand_role(id) = 'owner');

-- brand_members: visible to the brand, only owner/admin change roles.
create policy brand_members_select
  on public.brand_members for select
  to authenticated
  using (public.is_admin() or public.is_brand_member(brand_id));

create policy brand_members_insert
  on public.brand_members for insert
  to authenticated
  with check (
    public.is_admin()
    or (public.can_manage_brand(brand_id) and role <> 'owner')
  );

create policy brand_members_update
  on public.brand_members for update
  to authenticated
  using (public.is_admin() or public.brand_role(brand_id) = 'owner')
  with check (public.is_admin() or public.brand_role(brand_id) = 'owner');

create policy brand_members_delete
  on public.brand_members for delete
  to authenticated
  using (
    public.is_admin()
    or public.brand_role(brand_id) = 'owner'
    or (user_id = auth.uid() and role <> 'owner')
  );

-- creators: signed-in users can browse the creator marketplace; a creator
-- owns their own row; admins can manage everything.
create policy creators_select
  on public.creators for select
  to authenticated
  using (true);

create policy creators_insert
  on public.creators for insert
  to authenticated
  with check (
    public.is_admin()
    or (id = auth.uid() and public.is_creator())
  );

create policy creators_update
  on public.creators for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy creators_delete
  on public.creators for delete
  to authenticated
  using (public.is_admin());

-- social_accounts: signed-in users can browse; the owning creator manages
-- their rows; verification is handled by the trigger above.
create policy social_accounts_select
  on public.social_accounts for select
  to authenticated
  using (true);

create policy social_accounts_insert
  on public.social_accounts for insert
  to authenticated
  with check (creator_id = auth.uid() or public.is_admin());

create policy social_accounts_update
  on public.social_accounts for update
  to authenticated
  using (creator_id = auth.uid() or public.is_admin())
  with check (creator_id = auth.uid() or public.is_admin());

create policy social_accounts_delete
  on public.social_accounts for delete
  to authenticated
  using (creator_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants. RLS still decides which rows are reachable.
-- ---------------------------------------------------------------------------

grant select on public.platform_settings to anon;
grant select on
  public.profiles,
  public.brands,
  public.brand_members,
  public.creators,
  public.social_accounts
  to anon;
grant select, insert, update, delete on
  public.platform_settings,
  public.profiles,
  public.brands,
  public.brand_members,
  public.creators,
  public.social_accounts
  to authenticated, service_role;

grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.is_creator() to anon, authenticated, service_role;
grant execute on function public.is_brand_member(uuid) to anon, authenticated, service_role;
grant execute on function public.brand_role(uuid) to anon, authenticated, service_role;
grant execute on function public.can_manage_brand(uuid) to anon, authenticated, service_role;
grant execute on function public.shares_brand_with(uuid) to anon, authenticated, service_role;

revoke all on function public.create_brand(text) from public;
grant execute on function public.create_brand(text) to authenticated, service_role;

revoke all on function public.handle_new_user() from public;
revoke all on function public.protect_profile_fields() from public;
revoke all on function public.protect_brand_owner() from public;
revoke all on function public.protect_social_account_verification() from public;
