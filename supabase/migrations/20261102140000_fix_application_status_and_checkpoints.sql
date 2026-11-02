-- Step 4: fix application_status enum and view_checkpoints write authority.
-- application_status: exactly applied, approved, rejected, withdrawn.
-- 'pending' becomes 'applied', 'declined' becomes 'rejected'.
-- view_checkpoints: insert and update are admin-only (service role bypasses RLS).
-- Brand owners, managers and viewers may only read their campaigns' checkpoints.
-- A verified checkpoint stays immutable for everyone, including admin
-- (enforced by the protect_view_checkpoint trigger).

-- ---------------------------------------------------------------------------
-- 0. Drop policies that reference applications.status before altering the type
-- ---------------------------------------------------------------------------

drop policy if exists applications_update_creator on public.applications;
drop policy if exists applications_delete on public.applications;

-- ---------------------------------------------------------------------------
-- 1. application_status enum: replace with ('applied', 'approved', 'rejected', 'withdrawn')
-- ---------------------------------------------------------------------------

create type public.application_status_next as enum (
  'applied',
  'approved',
  'rejected',
  'withdrawn'
);

alter table public.applications
  alter column status drop default;

alter table public.applications
  alter column status type public.application_status_next
  using case status
    when 'pending' then 'applied'::public.application_status_next
    when 'approved' then 'approved'::public.application_status_next
    when 'declined' then 'rejected'::public.application_status_next
    when 'rejected' then 'rejected'::public.application_status_next
    when 'withdrawn' then 'withdrawn'::public.application_status_next
  end;

alter table public.applications
  alter column status set default 'applied';

drop type public.application_status;
alter type public.application_status_next rename to application_status;

-- ---------------------------------------------------------------------------
-- 2. view_checkpoints: writes are admin-only
-- ---------------------------------------------------------------------------

drop policy if exists view_checkpoints_update on public.view_checkpoints;

create policy view_checkpoints_update_admin
  on public.view_checkpoints for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Insert remains admin-only (already defined in the previous migration),
-- repeated here for clarity and self-containment.
drop policy if exists view_checkpoints_insert_admin on public.view_checkpoints;
create policy view_checkpoints_insert_admin
  on public.view_checkpoints for insert
  to authenticated
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. enforcement trigger: 'pending' -> 'applied'
-- ---------------------------------------------------------------------------

drop trigger if exists applications_enforce_rules on public.applications;

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
-- 4. Recreate applications policies with 'applied' instead of 'pending'
-- ---------------------------------------------------------------------------

create policy applications_update_creator
  on public.applications for update
  to authenticated
  using (creator_id = auth.uid())
  with check (
    creator_id = auth.uid()
    and status in ('applied', 'withdrawn')
  );

create policy applications_delete
  on public.applications for delete
  to authenticated
  using (
    public.is_admin()
    or (creator_id = auth.uid() and status = 'applied')
  );