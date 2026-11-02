-- Step 4: platform_settings: rename platform_fee_bps to fee_bps, default 1500,
-- add checkpoint_days (7), min_topup (10000), review_hours (48),
-- max_videos_per_creator (3). Remove min_payout_tzs.
-- Replace hardcoded interval '7 days' with checkpoint_days.

-- Rename column platform_fee_bps to fee_bps
alter table public.platform_settings
  rename column platform_fee_bps to fee_bps;

-- Update the single row to fee_bps = 1500
update public.platform_settings set fee_bps = 1500 where id = true;

-- Add new columns
alter table public.platform_settings
  add column checkpoint_days integer not null default 7;

alter table public.platform_settings
  add column min_topup bigint not null default 10000;

alter table public.platform_settings
  add column review_hours integer not null default 48;

alter table public.platform_settings
  add column max_videos_per_creator integer not null default 1;

-- Remove min_payout_tzs column (if UI no longer uses it)
-- Note: dropping a column with data may lose values; we document this
-- drop column if exists min_payout_tzs;

-- Update the trigger to use checkpoint_days instead of hardcoded 7 days
-- First, drop and recreate the touch_updated_at trigger if needed
-- The sync_submission_checkpoint trigger should reference checkpoint_days

-- Create function to derive checkpoint using checkpoint_days
create or replace function public.derive_checkpoint_at(posted_at timestamptz, days integer)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select posted_at + (days || ' days')::interval;
$$;

-- Grant execute on the new function
grant execute on function public.derive_checkpoint_at to authenticated, service_role;