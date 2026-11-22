-- Rejected videos no longer count toward a creator's video cap.
-- Reopening a rejected video re-checks the cap under the same row lock,
-- so a creator cannot exceed the cap by un-rejecting an old video.

create or replace function public.enforce_submission_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    where s.application_id = new.application_id
      and s.status <> 'rejected';

    if existing_count >= video_cap then
      raise exception 'submission cap of % videos reached', video_cap
        using errcode = 'check_violation';
    end if;

  elsif tg_op = 'UPDATE'
    and old.status = 'rejected'
    and new.status <> 'rejected'
  then
    -- Reopening a rejected video: same lock, same cap, excluding this row.
    perform 1
    from public.applications a
    where a.id = new.application_id
    for update;

    select c.videos_per_creator
    into video_cap
    from public.campaigns c
    where c.id = new.campaign_id;

    select count(*)::int
    into existing_count
    from public.submissions s
    where s.application_id = new.application_id
      and s.status <> 'rejected'
      and s.id <> new.id;

    if existing_count >= video_cap then
      raise exception 'submission cap of % videos reached', video_cap
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;