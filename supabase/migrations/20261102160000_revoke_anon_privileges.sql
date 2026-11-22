-- Step 6: revoke anon table privileges.
-- anon must have no privileges on any table and none on campaigns_public.
-- RLS policies are updated so they no longer list anon.

-- ---------------------------------------------------------------------------
-- 1. Revoke all table privileges from anon
-- ---------------------------------------------------------------------------

revoke all on public.platform_settings from anon;
revoke all on public.profiles from anon;
revoke all on public.brands from anon;
revoke all on public.brand_members from anon;
revoke all on public.creators from anon;
revoke all on public.social_accounts from anon;
revoke all on public.campaigns from anon;
revoke all on public.applications from anon;
revoke all on public.submissions from anon;
revoke all on public.view_checkpoints from anon;
revoke all on public.campaigns_public from anon;

-- ---------------------------------------------------------------------------
-- 2. platform_settings select: remove anon (policy is authenticated-only now)
-- ---------------------------------------------------------------------------

drop policy if exists platform_settings_select on public.platform_settings;

create policy platform_settings_select
  on public.platform_settings for select
  to authenticated
  using (true);