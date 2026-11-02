-- Step 3: campaigns, applications, submissions and view checkpoints.
-- Money is whole TZS (bigint). Timestamps are UTC timestamptz.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.campaign_status as enum (
  'draft',
  'live',
  'paused',
  'completed',
  'cancelled'
);

create type public.application_status as enum (
  'pending',
  'approved',
  'declined',
  'rejected',
  'withdrawn'
);

create type public.submission_status as enum (
  'awaiting',
  'revision',
  'approved',
  'rejected'
);

create type public.checkpoint_status as enum (
  'pending',
  'verified',
  'rejected'
);

-- Minimum rate is platform configuration, not a hard-coded client rule.
alter table public.platform_settings
  add column min_rate_per_1k bigint not null default 2000
    check (min_rate_per_1k >= 0);

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  created_by uuid not null default auth.uid()
    references public.profiles (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  brief text,
  status public.campaign_status not null default 'draft',
  platforms public.social_platform[] not null default '{}'::public.social_platform[]
    check (cardinality(platforms) > 0),
  niche text,
  rate_per_1k bigint not null check (rate_per_1k > 0),
  budget bigint not null check (budget > 0),
  creators_needed integer not null check (creators_needed > 0),
  max_videos_per_creator integer not null default 2
    check (max_videos_per_creator between 1 and 20),
  -- Same rule as the UI: budget split equally, rounded down.
  creator_cap bigint generated always as (
    floor(budget::numeric / creators_needed)::bigint
  ) stored,
  deadline date not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_brand_id_idx on public.campaigns (brand_id);
create index campaigns_created_by_idx on public.campaigns (created_by);
create index campaigns_live_idx on public.campaigns (id) where status = 'live';

create trigger campaigns_touch_updated_at
before update on public.campaigns
for each row execute function public.touch_updated_at();

create or replace function public.can_view_campaign(target_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaigns c
    where c.id = target_campaign_id
      and public.is_brand_member(c.brand_id)
  );
$$;

create or replace function public.can_manage_campaign(target_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select public.can_manage_brand(c.brand_id)
      from public.campaigns c
      where c.id = target_campaign_id
    ),
    false
  );
$$;

create or replace function public.campaign_is_live(target_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaigns c
    where c.id = target_campaign_id
      and c.status = 'live'
  );
$$;

-- Rate floor, immutable terms once published, and a safety net against
-- shrinking a campaign below the creators already approved.
create or replace function public.enforce_campaign_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  min_rate bigint;
  approved_count integer;
begin
  select ps.min_rate_per_1k
  into min_rate
  from public.platform_settings ps
  where ps.id = true;

  if new.rate_per_1k < coalesce(min_rate, 2000) then
    raise exception 'rate_per_1k must be at least % TZS', coalesce(min_rate, 2000)
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if old.status <> 'draft' and new.status = 'draft' then
      raise exception 'a published campaign cannot return to draft'
        using errcode = 'check_violation';
    end if;

    if old.status <> 'draft' and (
      new.rate_per_1k is distinct from old.rate_per_1k
      or new.budget is distinct from old.budget
      or new.creators_needed is distinct from old.creators_needed
      or new.max_videos_per_creator is distinct from old.max_videos_per_creator
      or new.platforms is distinct from old.platforms
      or new.deadline is distinct from old.deadline
    ) then
      raise exception 'campaign terms are immutable once published'
        using errcode = 'check_violation';
    end if;

    select count(*)::int
    into approved_count
    from public.applications a
    where a.campaign_id = new.id
      and a.status = 'approved';

    if new.creators_needed < approved_count then
      raise exception 'creators_needed cannot be lower than the % approved creators', approved_count
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger campaigns_enforce_rules
before insert or update on public.campaigns
for each row execute function public.enforce_campaign_rules();

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  creator_id uuid not null references public.creators (id) on delete cascade,
  status public.application_status not null default 'pending',
  pitch text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, creator_id)
);

create index applications_creator_id_idx on public.applications (creator_id);
create index applications_reviewed_by_idx on public.applications (reviewed_by);
create index applications_campaign_status_idx
  on public.applications (campaign_id, status);

create trigger applications_touch_updated_at
before update on public.applications
for each row execute function public.touch_updated_at();

-- Approval must lock the campaign row so two simultaneous approvals cannot
-- both pass the slot check.
create or replace function public.enforce_application_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  needed integer;
  campaign_state public.campaign_status;
  approved_count integer;
begin
  if tg_op = 'UPDATE' and (
    new.campaign_id is distinct from old.campaign_id
    or new.creator_id is distinct from old.creator_id
  ) then
    raise exception 'application campaign and creator cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status = 'approved' then
    if tg_op = 'INSERT' or old.status is distinct from 'approved' then
      select c.creators_needed, c.status
      into needed, campaign_state
      from public.campaigns c
      where c.id = new.campaign_id
      for update;

      if needed is null then
        raise exception 'campaign not found'
          using errcode = 'foreign_key_violation';
      end if;

      if campaign_state <> 'live' then
        raise exception 'creators can only be approved on a live campaign'
          using errcode = 'check_violation';
      end if;

      select count(*)::int
      into approved_count
      from public.applications a
      where a.campaign_id = new.campaign_id
        and a.status = 'approved'
        and a.id <> new.id;

      if approved_count >= needed then
        raise exception 'campaign creator cap of % reached', needed
          using errcode = 'check_violation';
      end if;

      new.reviewed_at := coalesce(new.reviewed_at, now());
      new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
    end if;
  end if;

  return new;
end;
$$;

create trigger applications_enforce_rules
before insert or update on public.applications
for each row execute function public.enforce_application_rules();

-- ---------------------------------------------------------------------------
-- submissions
-- ---------------------------------------------------------------------------

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  creator_id uuid not null references public.creators (id) on delete cascade,
  platform public.social_platform not null,
  video_url text not null check (char_length(btrim(video_url)) > 0),
  posted_at timestamptz not null,
  status public.submission_status not null default 'awaiting',
  note text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, video_url)
);

create index submissions_campaign_id_idx on public.submissions (campaign_id);
create index submissions_creator_id_idx on public.submissions (creator_id);
create index submissions_reviewed_by_idx on public.submissions (reviewed_by);
create index submissions_application_status_idx
  on public.submissions (application_id, status);

create trigger submissions_touch_updated_at
before update on public.submissions
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- view_checkpoints
-- ---------------------------------------------------------------------------

create table public.view_checkpoints (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  checkpoint_at timestamptz not null,
  views bigint not null default 0 check (views >= 0),
  status public.checkpoint_status not null default 'pending',
  verified_at timestamptz,
  verified_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index view_checkpoints_verified_by_idx on public.view_checkpoints (verified_by);
create index view_checkpoints_status_idx on public.view_checkpoints (status);

create trigger view_checkpoints_touch_updated_at
before update on public.view_checkpoints
for each row execute function public.touch_updated_at();

-- Approved application only, campaign live only, and a per-creator video cap.
create or replace function public.enforce_submission_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  application_state public.application_status;
  application_creator uuid;
  application_campaign uuid;
  video_cap integer;
  campaign_state public.campaign_status;
  existing_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.application_id is distinct from old.application_id
      or new.campaign_id is distinct from old.campaign_id
      or new.creator_id is distinct from old.creator_id
    then
      raise exception 'submission application, campaign and creator cannot be changed'
        using errcode = 'insufficient_privilege';
    end if;

    if new.posted_at is distinct from old.posted_at
      and exists (
        select 1
        from public.view_checkpoints vc
        where vc.submission_id = new.id
          and vc.status = 'verified'
      )
    then
      raise exception 'posted_at cannot change after checkpoint verification'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'INSERT' then
    select a.status, a.creator_id, a.campaign_id
    into application_state, application_creator, application_campaign
    from public.applications a
    where a.id = new.application_id;

    if application_state is null then
      raise exception 'application not found'
        using errcode = 'foreign_key_violation';
    end if;

    if application_state <> 'approved' then
      raise exception 'only approved creators can submit videos'
        using errcode = 'check_violation';
    end if;

    if application_creator <> new.creator_id
      or application_campaign <> new.campaign_id
    then
      raise exception 'submission must match its application'
        using errcode = 'check_violation';
    end if;

    select c.max_videos_per_creator, c.status
    into video_cap, campaign_state
    from public.campaigns c
    where c.id = new.campaign_id;

    if campaign_state <> 'live' then
      raise exception 'campaign must be live to accept submissions'
        using errcode = 'check_violation';
    end if;

    select count(*)::int
    into existing_count
    from public.submissions s
    where s.application_id = new.application_id;

    if existing_count >= video_cap then
      raise exception 'submission cap of % videos reached', video_cap
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger submissions_enforce_rules
before insert or update on public.submissions
for each row execute function public.enforce_submission_rules();

-- Every submission gets exactly one checkpoint: posted_at + 7 days.
create or replace function public.sync_submission_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.view_checkpoints (submission_id, checkpoint_at)
    values (new.id, new.posted_at + interval '7 days')
    on conflict (submission_id) do nothing;
  elsif new.posted_at is distinct from old.posted_at then
    update public.view_checkpoints
    set checkpoint_at = new.posted_at + interval '7 days'
    where submission_id = new.id
      and status <> 'verified';
  end if;

  return new;
end;
$$;

create trigger submissions_sync_checkpoint
after insert or update of posted_at on public.submissions
for each row execute function public.sync_submission_checkpoint();

-- Verification authority and immutability of a verified checkpoint.
create or replace function public.protect_view_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'verified' then
      if new.submission_id is distinct from old.submission_id
        or new.checkpoint_at is distinct from old.checkpoint_at
        or new.views is distinct from old.views
        or new.status is distinct from old.status
        or new.verified_at is distinct from old.verified_at
        or new.verified_by is distinct from old.verified_by
      then
        raise exception 'verified checkpoints are immutable'
          using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
  end if;

  if new.status = 'verified' then
    if not (
      auth.role() = 'service_role'
      or public.is_admin()
      or public.can_manage_submission(new.submission_id)
    ) then
      raise exception 'only the campaign brand or an admin can verify checkpoints'
        using errcode = 'insufficient_privilege';
    end if;

    new.verified_at := coalesce(new.verified_at, now());
    new.verified_by := coalesce(new.verified_by, auth.uid());
  end if;

  return new;
end;
$$;

create trigger view_checkpoints_protect
before insert or update on public.view_checkpoints
for each row execute function public.protect_view_checkpoint();

create or replace function public.can_view_submission(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.submissions s
    where s.id = target_submission_id
      and (
        s.creator_id = auth.uid()
        or public.can_view_campaign(s.campaign_id)
      )
  );
$$;

create or replace function public.can_manage_submission(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.submissions s
    where s.id = target_submission_id
      and public.can_manage_campaign(s.campaign_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.campaigns enable row level security;
alter table public.applications enable row level security;
alter table public.submissions enable row level security;
alter table public.view_checkpoints enable row level security;

-- campaigns: brand members manage their own campaigns; creators use the
-- campaigns_public view for discovery.
create policy campaigns_select
  on public.campaigns for select
  to authenticated
  using (public.is_admin() or public.is_brand_member(brand_id));

create policy campaigns_insert
  on public.campaigns for insert
  to authenticated
  with check (
    public.is_admin()
    or (public.can_manage_brand(brand_id) and created_by = auth.uid())
  );

create policy campaigns_update
  on public.campaigns for update
  to authenticated
  using (public.is_admin() or public.can_manage_brand(brand_id))
  with check (public.is_admin() or public.can_manage_brand(brand_id));

create policy campaigns_delete
  on public.campaigns for delete
  to authenticated
  using (public.is_admin() or public.brand_role(brand_id) = 'owner');

-- applications: creators see their own; brand members see applications to
-- their campaigns. Creators cannot approve themselves.
create policy applications_select
  on public.applications for select
  to authenticated
  using (
    creator_id = auth.uid()
    or public.is_admin()
    or public.can_view_campaign(campaign_id)
  );

create policy applications_insert
  on public.applications for insert
  to authenticated
  with check (
    creator_id = auth.uid()
    and public.is_creator()
    and public.campaign_is_live(campaign_id)
  );

create policy applications_update_creator
  on public.applications for update
  to authenticated
  using (creator_id = auth.uid())
  with check (
    creator_id = auth.uid()
    and status in ('pending', 'withdrawn')
  );

create policy applications_update_brand
  on public.applications for update
  to authenticated
  using (public.can_manage_campaign(campaign_id))
  with check (public.can_manage_campaign(campaign_id));

create policy applications_update_admin
  on public.applications for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy applications_delete
  on public.applications for delete
  to authenticated
  using (
    public.is_admin()
    or (creator_id = auth.uid() and status = 'pending')
  );

-- submissions: creator owns the row, brand sees its campaign rows.
create policy submissions_select
  on public.submissions for select
  to authenticated
  using (
    creator_id = auth.uid()
    or public.is_admin()
    or public.can_view_campaign(campaign_id)
  );

create policy submissions_insert
  on public.submissions for insert
  to authenticated
  with check (creator_id = auth.uid() and public.is_creator());

create policy submissions_update_creator
  on public.submissions for update
  to authenticated
  using (creator_id = auth.uid() and status in ('awaiting', 'revision'))
  with check (
    creator_id = auth.uid()
    and status in ('awaiting', 'revision')
  );

create policy submissions_update_brand
  on public.submissions for update
  to authenticated
  using (public.can_manage_campaign(campaign_id))
  with check (public.can_manage_campaign(campaign_id));

create policy submissions_update_admin
  on public.submissions for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy submissions_delete
  on public.submissions for delete
  to authenticated
  using (
    public.is_admin()
    or (creator_id = auth.uid() and status = 'awaiting')
  );

-- view_checkpoints: derived rows are inserted by the submission trigger;
-- only campaign managers/admins verify them.
create policy view_checkpoints_select
  on public.view_checkpoints for select
  to authenticated
  using (public.is_admin() or public.can_view_submission(submission_id));

create policy view_checkpoints_insert_admin
  on public.view_checkpoints for insert
  to authenticated
  with check (public.is_admin());

create policy view_checkpoints_update
  on public.view_checkpoints for update
  to authenticated
  using (public.is_admin() or public.can_manage_submission(submission_id))
  with check (public.is_admin() or public.can_manage_submission(submission_id));

create policy view_checkpoints_delete_admin
  on public.view_checkpoints for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Public discovery view: live campaigns only, never budget or creator cap.
-- Owner-privileged so it works without exposing the base table through RLS.
-- ---------------------------------------------------------------------------

create view public.campaigns_public
with (security_invoker = false)
as
select
  c.id,
  c.brand_id,
  b.name as brand_name,
  c.title,
  c.brief,
  c.status,
  c.platforms,
  c.niche,
  c.rate_per_1k,
  c.creators_needed,
  c.max_videos_per_creator,
  c.deadline,
  c.created_at,
  c.updated_at
from public.campaigns c
join public.brands b on b.id = c.brand_id
where c.status = 'live';

revoke all on public.campaigns_public from public;
revoke all on public.campaigns_public from anon;
grant select on public.campaigns_public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants (RLS still decides rows)
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  public.campaigns,
  public.applications,
  public.submissions,
  public.view_checkpoints
  to authenticated, service_role;

grant select on
  public.campaigns,
  public.applications,
  public.submissions,
  public.view_checkpoints
  to anon;

grant execute on function public.can_view_campaign(uuid) to authenticated, service_role;
grant execute on function public.can_manage_campaign(uuid) to authenticated, service_role;
grant execute on function public.campaign_is_live(uuid) to authenticated, service_role;
grant execute on function public.can_view_submission(uuid) to authenticated, service_role;
grant execute on function public.can_manage_submission(uuid) to authenticated, service_role;

revoke all on function public.enforce_campaign_rules() from public;
revoke all on function public.enforce_application_rules() from public;
revoke all on function public.enforce_submission_rules() from public;
revoke all on function public.sync_submission_checkpoint() from public;
revoke all on function public.protect_view_checkpoint() from public;
