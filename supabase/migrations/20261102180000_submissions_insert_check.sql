-- Step 2: submissions insert must force status = awaiting and reviewed_by/reviewed_at null.
-- Require posted_at <= now() + 5 minutes and posted_at >= application's approval time.
-- Creators cannot change posted_at after insert.

create or replace function public.enforce_submission_status_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Force status to awaiting on insert
  if new.status != 'awaiting' then
    raise exception 'submission status must be awaiting on insert'
      using errcode = 'check_violation';
  end if;

  -- Ensure reviewed_by and reviewed_at are null on insert
  if new.reviewed_by is not null then
    raise exception 'reviewed_by must be null on insert'
      using errcode = 'check_violation';
  end if;

  if new.reviewed_at is not null then
    raise exception 'reviewed_at must be null on insert'
      using errcode = 'check_violation';
  end if;

  -- posted_at must be within 5 minutes of now (approximate check)
  if new.posted_at > now() + interval '5 minutes' then
    raise exception 'posted_at must be within 5 minutes of submission time'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_submission_status_insert
  before insert on public.submissions
  for each row execute function public.enforce_submission_status_insert();

-- Update submissions_insert policy
drop policy if exists submissions_insert on public.submissions;

create policy submissions_insert
  on public.submissions for insert
  to authenticated
  with check (
    creator_id = auth.uid()
    and status = 'awaiting'
    and reviewed_by is null
    and reviewed_at is null
  );