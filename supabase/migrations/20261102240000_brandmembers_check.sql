-- Step 8: brand_members insert and update: only the owner or admin.
-- (managers can no longer add members).

-- Update brand_members policies
drop policy if exists brand_members_insert on public.brand_members;
drop policy if exists brand_members_update on public.brand_members;

-- Only owner or admin can insert brand members
create policy brand_members_insert
  on public.brand_members for insert
  to authenticated
  using (
    public.is_admin()
    or (brand_id in (
      select brand_id from public.brand_members where user_id = auth.uid() and role = 'owner'
    ))
  );

-- Only owner or admin can update brand members
create policy brand_members_update
  on public.brand_members for update
  to authenticated
  using (
    public.is_admin()
    or (brand_id in (
      select brand_id from public.brand_members where user_id = auth.uid() and role = 'owner'
    ))
  );