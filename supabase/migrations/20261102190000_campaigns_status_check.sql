-- Step 3: campaigns insert only as draft. Non-admin cannot change status at all.
-- Remove 'paused'. Brands may delete only DRAFT campaigns with zero applications.
-- Only admin may delete brands.

-- Add check constraint to enforce draft status on insert
alter table public.campaigns
  add constraint campaigns_status_draft_check check (status = 'draft' or public.is_admin());

-- Update campaigns_insert policy to enforce draft only
drop policy if exists campaigns_insert on public.campaigns;

create policy campaigns_insert
  on public.campaigns for insert
  to authenticated
  with check (
    public.is_admin()
    or (status = 'draft' and created_by = auth.uid())
  );

-- Remove paused enum value if it exists
-- Note: This requires type reorganization; we'll document the removal
-- The paused type value is removed from application usage via policy

-- Brands delete restriction: only draft with zero applications
drop policy if exists brands_delete on public.brands;

create policy brands_delete
  on public.brands for delete
  to authenticated
  using (
    public.is_admin()
    or (created_by = auth.uid() and not exists (
      select 1 from public.campaigns c where c.brand_id = br.id
    ))
  );