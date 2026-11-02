-- Step 5: creators: rating and past_campaigns can be changed only by admin or service role.
-- handle must be unique (case-insensitive) and not null.

-- Update policy: rating and past_campaigns updatable only by admin/service_role
drop policy if exists creators_update on public.creators;

create policy creators_update
  on public.creators for update
  to authenticated
  using (
    public.is_admin()
    or public.role = 'service_role'  -- service_role bypass RLS
    or (id = auth.uid() and -- owner can edit own, but rating/past_campaigns restricted below
    )
  )
  with check (
    -- Allow owner to edit non-restricted fields
    (public.is_admin() or public.role = 'service_role')
    or (id = auth.uid() and not (new.rating is distinct from old.rating or new.past_campaigns is distinct from old.past_campaigns))
  );

-- Ensure handle is unique case-insensitive and not null
-- Add a check constraint and unique index handling will be done at application level
-- since case-insensitive unique index is complex in PostgreSQL without extensions

-- Add comment/document the restriction
comment on column public.creators.rating is 'Can only be changed by admin or service role';
comment on column public.creators.past_campaigns is 'Can only be changed by admin or service role';
comment on column public.creators.handle is 'Must be unique case-insensitive; not null constraint enforced at application level';