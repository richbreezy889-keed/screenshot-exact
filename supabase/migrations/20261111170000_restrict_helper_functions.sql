-- Helper functions must answer only for people who are party to the record.
-- Anyone else gets null/false, the same answer as for a record that does not exist.

create or replace function public.application_approved_at(target_application_id uuid)
returns timestamp with time zone
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.reviewed_at
  from public.applications a
  where a.id = target_application_id
    and (
      a.creator_id = auth.uid()
      or public.can_manage_campaign(a.campaign_id)
      or public.is_admin()
    );
$function$;

create or replace function public.application_has_submissions(target_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.applications a
    join public.submissions s on s.application_id = a.id
    where a.id = target_application_id
      and (
        a.creator_id = auth.uid()
        or public.can_manage_campaign(a.campaign_id)
        or public.is_admin()
      )
  );
$function$;

create or replace function public.campaign_has_applications(target_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.applications a
    where a.campaign_id = target_campaign_id
      and (
        public.can_view_campaign(target_campaign_id)
        or a.creator_id = auth.uid()
        or public.is_admin()
      )
  );
$function$;

-- Anonymous visitors have no table access and no reason to call any helper.
revoke execute on function
  public.application_approved_at(uuid),
  public.application_has_submissions(uuid),
  public.brand_role(uuid),
  public.campaign_has_applications(uuid),
  public.campaign_is_live(uuid),
  public.can_manage_brand(uuid),
  public.can_manage_campaign(uuid),
  public.can_manage_submission(uuid),
  public.can_view_campaign(uuid),
  public.can_view_submission(uuid),
  public.is_admin(),
  public.is_brand(),
  public.is_brand_member(uuid),
  public.is_creator(),
  public.shares_brand_with(uuid),
  public.create_brand(text)
from public, anon;

grant execute on function
  public.application_approved_at(uuid),
  public.application_has_submissions(uuid),
  public.brand_role(uuid),
  public.campaign_has_applications(uuid),
  public.campaign_is_live(uuid),
  public.can_manage_brand(uuid),
  public.can_manage_campaign(uuid),
  public.can_manage_submission(uuid),
  public.can_view_campaign(uuid),
  public.can_view_submission(uuid),
  public.is_admin(),
  public.is_brand(),
  public.is_brand_member(uuid),
  public.is_creator(),
  public.shares_brand_with(uuid),
  public.create_brand(text)
to authenticated, service_role;