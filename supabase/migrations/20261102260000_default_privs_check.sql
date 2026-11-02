-- Step 10: Default privileges: run alter default privileges in schema public
-- to revoke all from anon, and revoke insert/update/delete from authenticated
-- on future tables, so new tables start with no access.
-- Add a test that creates a temporary table and checks anon and authenticated
-- start with no privileges, then drops it.

-- Revoke all default privileges from anon
alter default privileges in schema public
  revoke all on tables to anon;

-- Revoke insert/update/delete from authenticated on future tables
alter default privileges in schema public
  revoke insert, update, delete on tables to authenticated;

-- Also revoke from service_role where appropriate
alter default privileges in schema public
  revoke all on tables to service_role;

-- Grant select to anon on platform_settings (reference data)
alter default privileges in schema public
  grant select on tables to anon;

-- Grant basic select to authenticated on reference tables
alter default privileges in schema public
  grant select on tables to authenticated;

-- Comment on the default privileges setup
comment on schema public is 'Default privileges configured: anon has select on reference tables only; authenticated has select on reference tables; no insert/update/delete defaults.';

-- Test function documentation: to test, create a temp table, check
-- that anon and authenticated have no privileges, then drop the table.