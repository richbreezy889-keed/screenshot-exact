# Supabase — Shim vs Hosted Behaviour

The in-process PGlite shim (`scripts/db/shim.sql`) is a stand-in for the
Supabase-managed pieces that the migrations rely on. It is used by
`db:reset`, `db:test` and `db:types`. It must never be applied to a hosted
Supabase project.

The shim does **not** reproduce the following Supabase behaviours:

1. **JWT claims behind `auth.uid()`**
   Real Supabase verifies a JWT and extracts `sub` from the verified claims.
   The shim reads `request.jwt.claim.sub` / `request.jwt.claims` from
   PostgreSQL GUCs, which any superuser can spoof with `set_config`. There is
   no signature verification, expiry check, or issuer validation.

2. **Role switching**
   Real Supabase derives the request role (`anon`, `authenticated`,
   `service_role`) from the JWT. The shim uses `set role` plus
   `request.jwt.claim.role` GUCs, so the role is set explicitly per test
   rather than derived from a token.

3. **The `auth.users` sign-up trigger**
   Real Supabase runs `handle_new_user()` automatically on `auth.users`
   inserts through the Auth service. The shim has the trigger defined, but
   tests insert directly into the shim's `auth.users` table; there is no
   Auth service, email confirmation, or audit entry.

4. **Default grants / auto-exposure of new tables**
   Real Supabase can auto-expose new tables to Data API roles based on
   `auto_expose_new_tables`. The shim explicitly grants defaults via
   `bootstrap.mjs` (`DEFAULT_PRIVILEGES`) and every table/view privilege is
   managed explicitly in migrations.

5. **View ownership and `security_invoker`**
   `campaigns_public` is created with `security_invoker = false` so it runs
   with the view owner's privileges. In the shim, the table owner is the
   PGlite superuser; in hosted Supabase, the view owner is the
   `supabase_admin` role. RLS behaviour for security_invoker views can differ
   between PGlite and real PostgREST.

These differences mean the shim is suitable for schema and RLS logic
verification, but not for testing auth token handling, role derivation from
JWTs, or the exact grant/ownership semantics of a hosted project.
## Test harness limits (PGlite)

- The shim in `scripts/db/shim.sql` imitates Supabase's `auth` schema and roles. It grants `usage` on schema `auth` and `execute` on `auth.uid()`, `auth.role()` and `auth.jwt()` to `anon`, `authenticated` and `service_role`, as real Supabase does. Confirm this against the hosted project.
- PGlite has one connection, so true concurrency (two creators submitting the last video slot at once) cannot be proved locally. `enforce_submission_rules` locks the application row (`for update`); the hosted run must prove it.
- Guard triggers (`guard_*`) are SECURITY INVOKER and only restrict `anon` and `authenticated`. SECURITY DEFINER server functions run as the owner and bypass them on purpose.
- Guard triggers run before the row-level-security check, so some attacks fail with a guard message instead of "row-level security". Both are rejections.
- Default privileges are revoked for new tables and functions: every new table needs explicit grants and RLS policies.
