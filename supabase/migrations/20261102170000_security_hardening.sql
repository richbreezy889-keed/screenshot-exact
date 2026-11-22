-- Security hardening (replaces the earlier unapplied drafts 180000-260000).
--
-- Closes these holes found in review:
--   1. creators could insert an application as 'approved' (self-approval)
--   2. creators could insert a submission as 'approved' (self-approval)
--   3. brands could insert campaigns as 'live' or flip draft -> live
--   4. platform fee default was 20% (must be 15%) and settings were missing
--   5. creators could edit their own rating / past_campaigns
--   6. checkpoints had no evidence and could be verified before the date
--   7. videos per creator defaulted to 2 (max 20); design says 1 (max 3)
--   8. managers could add team members (owner only)
--   9. owners could delete live campaigns / brands
--  10. new tables got default access for anon and authenticated
--
-- Guard triggers are SECURITY INVOKER on purpose: current_user is then the
-- API role of the caller ('anon' / 'authenticated'). Later server functions
-- are SECURITY DEFINER, run as the owner, and enforce their own rules.

-- ---------------------------------------------------------------------------
-- 1. platform_settings: fee 15% and the settings the design relies on
-- ---------------------------------------------------------------------------

alter table public.platform_settings
  rename column platform_fee_bps to fee_bps;

alter table public.platform_settings
  alter column fee_bps set default 1500;

update public.platform_settings set fee_bps = 1500 where id;

alter table public.platform_settings
  add column checkpoint_days integer not null default 7
    check (checkpoint_days between 1 and 60),
  add column min_topup bigint not null default 10000
    check (min_topup >= 0),
  add column review_hours integer not null default 48
    check (review_hours between 0 and 720),
  add column max_videos_per_creator integer not null default 3
    check (max_videos_per_creator between 1 and 10),
  drop column min_payout_tzs;

-- ---------------------------------------------------------------------------
-- 2. Helper lookups (SECURITY DEFINER so RLS does not recurse)
-- ---------------------------------------------------------------------------

create or replace function public.application_has_submissions(target_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.submissions s where s.application_id = target_application_id
  );
$$;

create or replace function public.application_approved_at(target_application_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select a.reviewed_at from public.applications a where a.id = target_application_id;
$$;

create or replace function public.campaign_has_applications(target_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.applications a where a.campaign_id = target_campaign_id
  );
$$;

grant execute on function public.application_has_submissions(uuid) to authenticated, service_role;
grant execute on function public.application_approved_at(uuid) to authenticated, service_role;
grant execute on function public.campaign_has_applications(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. campaigns: videos per creator, draft-only client writes, safe deletes
-- ---------------------------------------------------------------------------

alter table public.campaigns
  rename column max_videos_per_creator to videos_per_creator;

alter table public.campaigns
  drop constraint if exists campaigns_max_videos_per_creator_check;

alter table public.campaigns
  alter column videos_per_creator set default 1;

alter table public.campaigns
  add constraint campaigns_videos_per_creator_check
    check (videos_per_creator between 1 and 3);

-- 'paused' was never defined in the design; keep the enum value but forbid it.
alter table public.campaigns
  add constraint campaigns_status_not_paused check (status <> 'paused');

create or replace function public.enforce_campaign_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  min_rate bigint;
  max_videos integer;
  approved_count integer;
begin
  select ps.min_rate_per_1k, ps.max_videos_per_creator
  into min_rate, max_videos
  from public.platform_settings ps
  where ps.id = true;

  if new.rate_per_1k < coalesce(min_rate, 2000) then
    raise exception 'rate_per_1k must be at least % TZS', coalesce(min_rate, 2000)
      using errcode = 'check_violation';
  end if;

  if new.videos_per_creator > coalesce(max_videos, 3) then
    raise exception 'videos_per_creator cannot exceed %', coalesce(max_videos, 3)
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
      or new.videos_per_creator is distinct from old.videos_per_creator
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

-- Clients (anon / authenticated) may create DRAFT campaigns and edit them.
-- Publishing, cancelling and completing are done by server functions or admins.
create or replace function public.guard_campaign_client_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.status <> 'draft' then
        raise exception 'campaigns can only be created as drafts'
          using errcode = 'insufficient_privilege';
      end if;
      new.published_at := null;
    else
      if new.status is distinct from old.status then
        raise exception 'campaign status can only be changed by the platform'
          using errcode = 'insufficient_privilege';
      end if;
      if new.published_at is distinct from old.published_at then
        raise exception 'published_at can only be changed by the platform'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger campaigns_guard_client_writes
before insert or update on public.campaigns
for each row execute function public.guard_campaign_client_writes();

drop policy if exists campaigns_insert on public.campaigns;
create policy campaigns_insert
  on public.campaigns for insert
  to authenticated
  with check (
    public.is_admin()
    or (
      public.can_manage_brand(brand_id)
      and created_by = auth.uid()
      and status = 'draft'
    )
  );

-- Only an owner may delete, and only a draft nobody has applied to.
drop policy if exists campaigns_delete on public.campaigns;
create policy campaigns_delete
  on public.campaigns for delete
  to authenticated
  using (
    public.is_admin()
    or (
      public.brand_role(brand_id) = 'owner'
      and status = 'draft'
      and not public.campaign_has_applications(id)
    )
  );

-- Brands (and their campaign history) are removed by admins only.
drop policy if exists brands_delete on public.brands;
create policy brands_delete
  on public.brands for delete
  to authenticated
  using (public.is_admin());

-- Public discovery view: rebuilt for the renamed column, plus open slots.
drop view public.campaigns_public;

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
  greatest(
    c.creators_needed - (
      select count(*)::int
      from public.applications a
      where a.campaign_id = c.id
        and a.status = 'approved'
    ),
    0
  ) as open_slots,
  c.videos_per_creator,
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
-- 4. applications: no self-approval, controlled transitions
-- ---------------------------------------------------------------------------

drop policy if exists applications_insert on public.applications;
create policy applications_insert
  on public.applications for insert
  to authenticated
  with check (
    creator_id = auth.uid()
    and public.is_creator()
    and public.campaign_is_live(campaign_id)
    and status = 'applied'
    and reviewed_by is null
    and reviewed_at is null
  );

-- A creator can edit a waiting application or withdraw (an approved one only
-- until a video exists). Every other change belongs to the brand.
drop policy if exists applications_update_creator on public.applications;
create policy applications_update_creator
  on public.applications for update
  to authenticated
  using (
    creator_id = auth.uid()
    and (
      status = 'applied'
      or (status = 'approved' and not public.application_has_submissions(id))
    )
  )
  with check (
    creator_id = auth.uid()
    and status in ('applied', 'withdrawn')
  );

drop policy if exists applications_delete on public.applications;
create policy applications_delete
  on public.applications for delete
  to authenticated
  using (
    public.is_admin()
    or (creator_id = auth.uid() and status = 'applied')
  );

create or replace function public.guard_application_client_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.status <> 'applied' then
        raise exception 'applications must start as applied'
          using errcode = 'insufficient_privilege';
      end if;
      new.reviewed_by := null;
      new.reviewed_at := null;
    elsif new.status is distinct from old.status then
      if public.can_manage_campaign(old.campaign_id) then
        if not (old.status = 'applied' and new.status in ('approved', 'rejected')) then
          raise exception 'a brand can only approve or reject an application that is waiting'
            using errcode = 'insufficient_privilege';
        end if;
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      elsif old.creator_id = auth.uid() then
        if new.status <> 'withdrawn' or old.status not in ('applied', 'approved') then
          raise exception 'a creator can only withdraw their own application'
            using errcode = 'insufficient_privilege';
        end if;
        if old.status = 'approved' and public.application_has_submissions(old.id) then
          raise exception 'an application with submitted videos cannot be withdrawn'
            using errcode = 'insufficient_privilege';
        end if;
        new.reviewed_by := old.reviewed_by;
        new.reviewed_at := old.reviewed_at;
      else
        raise exception 'not allowed to change this application'
          using errcode = 'insufficient_privilege';
      end if;
    else
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;

    if tg_op = 'UPDATE'
      and public.can_manage_campaign(old.campaign_id)
      and new.pitch is distinct from old.pitch
    then
      raise exception 'a brand cannot edit the creator pitch'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger applications_guard_client_writes
before insert or update on public.applications
for each row execute function public.guard_application_client_writes();

-- ---------------------------------------------------------------------------
-- 5. submissions: no self-approval, honest posted_at, locked cap check
-- ---------------------------------------------------------------------------

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
    -- Lock the application row so two simultaneous inserts cannot both pass
    -- the cap check below.
    select a.status, a.creator_id, a.campaign_id
    into application_state, application_creator, application_campaign
    from public.applications a
    where a.id = new.application_id
    for update;

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

    select c.videos_per_creator, c.status
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

drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert
  on public.submissions for insert
  to authenticated
  with check (
    creator_id = auth.uid()
    and public.is_creator()
    and status = 'awaiting'
    and reviewed_by is null
    and reviewed_at is null
  );

drop policy if exists submissions_update_creator on public.submissions;
create policy submissions_update_creator
  on public.submissions for update
  to authenticated
  using (creator_id = auth.uid() and status in ('awaiting', 'revision'))
  with check (creator_id = auth.uid() and status = 'awaiting');

create or replace function public.guard_submission_client_writes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  approved_at timestamptz;
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.status <> 'awaiting' then
        raise exception 'submissions must start as awaiting'
          using errcode = 'insufficient_privilege';
      end if;
      new.reviewed_by := null;
      new.reviewed_at := null;

      if new.posted_at > now() + interval '5 minutes' then
        raise exception 'posted_at cannot be in the future'
          using errcode = 'check_violation';
      end if;

      approved_at := public.application_approved_at(new.application_id);
      if approved_at is not null and new.posted_at < approved_at - interval '5 minutes' then
        raise exception 'posted_at cannot be earlier than the approval of the application'
          using errcode = 'check_violation';
      end if;
    else
      if new.posted_at is distinct from old.posted_at
        or new.platform is distinct from old.platform
      then
        raise exception 'only an admin can change posted_at or platform after submitting'
          using errcode = 'insufficient_privilege';
      end if;

      if old.creator_id = auth.uid() then
        if new.status <> 'awaiting' then
          raise exception 'a creator can only resubmit a video as awaiting'
            using errcode = 'insufficient_privilege';
        end if;
        new.reviewed_by := old.reviewed_by;
        new.reviewed_at := old.reviewed_at;
      elsif public.can_manage_campaign(old.campaign_id) then
        if new.video_url is distinct from old.video_url then
          raise exception 'a brand cannot change the video link'
            using errcode = 'insufficient_privilege';
        end if;
        if new.status is distinct from old.status then
          if not (old.status = 'awaiting' and new.status in ('approved', 'revision', 'rejected')) then
            raise exception 'a brand can only approve, reject or request revision of a waiting video'
              using errcode = 'insufficient_privilege';
          end if;
          new.reviewed_by := auth.uid();
          new.reviewed_at := now();
        else
          new.reviewed_by := old.reviewed_by;
          new.reviewed_at := old.reviewed_at;
        end if;
      else
        raise exception 'not allowed to change this submission'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger submissions_guard_client_writes
before insert or update on public.submissions
for each row execute function public.guard_submission_client_writes();

-- ---------------------------------------------------------------------------
-- 6. creators: platform-owned fields and a unique handle
-- ---------------------------------------------------------------------------

alter table public.creators
  alter column handle set not null;

alter table public.creators
  add constraint creators_handle_length
    check (char_length(btrim(handle)) between 2 and 40);

create unique index creators_handle_lower_idx
  on public.creators (lower(handle));

create or replace function public.guard_creator_client_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.rating <> 0 or new.past_campaigns <> 0 then
        raise exception 'rating and past_campaigns are set by the platform'
          using errcode = 'insufficient_privilege';
      end if;
    elsif new.rating is distinct from old.rating
      or new.past_campaigns is distinct from old.past_campaigns
    then
      raise exception 'rating and past_campaigns are set by the platform'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger creators_guard_client_writes
before insert or update on public.creators
for each row execute function public.guard_creator_client_writes();

-- ---------------------------------------------------------------------------
-- 7. view_checkpoints: evidence, date check, admin-only, settings-driven date
-- ---------------------------------------------------------------------------

alter table public.view_checkpoints
  add column evidence_url text
    check (evidence_url is null or char_length(btrim(evidence_url)) > 0);

-- Recreated as SECURITY INVOKER so current_user is the caller's API role.
create or replace function public.protect_view_checkpoint()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'verified' then
    if new.submission_id is distinct from old.submission_id
      or new.checkpoint_at is distinct from old.checkpoint_at
      or new.views is distinct from old.views
      or new.status is distinct from old.status
      or new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by
      or new.evidence_url is distinct from old.evidence_url
    then
      raise exception 'verified checkpoints are immutable'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT'
      or new.views is distinct from old.views
      or new.status is distinct from old.status
      or new.evidence_url is distinct from old.evidence_url
      or new.checkpoint_at is distinct from old.checkpoint_at
    then
      raise exception 'only an admin can write view checkpoints'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status = 'verified' then
    if new.evidence_url is null then
      raise exception 'evidence_url is required to verify a checkpoint'
        using errcode = 'check_violation';
    end if;

    if new.checkpoint_at > now() then
      raise exception 'a checkpoint cannot be verified before its checkpoint date'
        using errcode = 'check_violation';
    end if;

    new.verified_at := now();
    new.verified_by := coalesce(auth.uid(), new.verified_by);
  end if;

  return new;
end;
$$;

-- The checkpoint date follows platform_settings.checkpoint_days.
create or replace function public.sync_submission_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  days integer;
begin
  select ps.checkpoint_days into days
  from public.platform_settings ps
  where ps.id = true;

  days := coalesce(days, 7);

  if tg_op = 'INSERT' then
    insert into public.view_checkpoints (submission_id, checkpoint_at)
    values (new.id, new.posted_at + make_interval(days => days))
    on conflict (submission_id) do nothing;
  elsif new.posted_at is distinct from old.posted_at then
    update public.view_checkpoints
    set checkpoint_at = new.posted_at + make_interval(days => days)
    where submission_id = new.id
      and status <> 'verified';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. brand_members: only the owner (or an admin) manages the team
-- ---------------------------------------------------------------------------

drop policy if exists brand_members_insert on public.brand_members;
create policy brand_members_insert
  on public.brand_members for insert
  to authenticated
  with check (
    public.is_admin()
    or (public.brand_role(brand_id) = 'owner' and role <> 'owner')
  );

drop policy if exists brand_members_update on public.brand_members;
create policy brand_members_update
  on public.brand_members for update
  to authenticated
  using (public.is_admin() or public.brand_role(brand_id) = 'owner')
  with check (
    public.is_admin()
    or (public.brand_role(brand_id) = 'owner' and role <> 'owner')
  );

-- ---------------------------------------------------------------------------
-- 9. Default privileges: new tables, sequences and functions start closed.
--    service_role keeps its defaults. Later migrations must GRANT explicitly.
-- ---------------------------------------------------------------------------

alter default privileges in schema public
  revoke all on tables from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

alter default privileges
  revoke execute on functions from public;

-- Trigger functions are never callable through the API.
revoke all on function public.guard_campaign_client_writes() from public, anon, authenticated;
revoke all on function public.guard_application_client_writes() from public, anon, authenticated;
revoke all on function public.guard_submission_client_writes() from public, anon, authenticated;
revoke all on function public.guard_creator_client_writes() from public, anon, authenticated;
revoke all on function public.protect_view_checkpoint() from public, anon, authenticated;
revoke all on function public.enforce_campaign_rules() from public, anon, authenticated;
revoke all on function public.enforce_submission_rules() from public, anon, authenticated;
revoke all on function public.sync_submission_checkpoint() from public, anon, authenticated;
