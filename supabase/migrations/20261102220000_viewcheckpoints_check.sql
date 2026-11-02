-- Step 6: view_checkpoints: add evidence_url text.
-- Setting status to 'verified' requires evidence_url not null, checkpoint_at <= now(),
-- and an admin or service role.
-- Remove the can_manage_submission path from protect_view_checkpoint.

-- Add evidence_url column to view_checkpoints
alter table public.view_checkpoints
  add column evidence_url text;

-- Update protect_view_checkpoint trigger to enforce evidence requirements
drop trigger if exists view_checkpoints_protect on public.view_checkpoints;

create or replace function public.protect_view_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'verified' then
    -- Require evidence_url not null
    if new.evidence_url is null then
      raise exception 'evidence_url is required to verify a checkpoint'
        using errcode = 'check_violation';
    end if;

    -- Require checkpoint_at <= now()
    if new.checkpoint_at > now() then
      raise exception 'checkpoint_at must be in the past to verify'
        using errcode = 'check_violation';
    end if;

    -- Require admin or service role (removed can_manage_submission path)
    if not (public.is_admin() or public.role = 'service_role') then
      raise exception 'only admin or service role can verify checkpoints'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger view_checkpoints_protect
  before insert or update on public.view_checkpoints
  for each row execute function public.protect_view_checkpoint();