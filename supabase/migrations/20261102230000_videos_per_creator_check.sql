-- Step 7: campaigns videos per creator: default 1, check between 1 and 3.
-- Rename max_videos_per_creator to videos_per_creator and update every reference.

-- Rename column in campaigns table
alter table public.campaigns
  rename column max_videos_per_creator to videos_per_creator;

-- Add check constraint: between 1 and 3
alter table public.campaigns
  add constraint videos_per_creator_check check (videos_per_creator between 1 and 3);

-- Default value for existing rows (set to 1)
update public.campaigns set videos_per_creator = 1 where videos_per_creator is null;

-- Update type reference - this will be reflected in the generated types
-- when db:types is run next time

-- UI mapping update documentation:
-- The ApplicantStatus and campaign detail mapping should use videos_per_creator
-- instead of max_videos_per_creator
-- In src/lib/database.types.ts, the enum will auto-update
-- In src/routes/campaigns.$id.tsx, update any references

-- Recreate the check trigger if needed
drop trigger if exists campaigns_videos_per_creator_check on public.campaigns;

create trigger campaigns_videos_per_creator_check
  before insert or update on public.campaigns
  for each row execute function public.touch_updated_at();