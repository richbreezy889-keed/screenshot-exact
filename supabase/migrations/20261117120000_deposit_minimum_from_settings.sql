-- Deposits: the minimum top-up follows platform_settings.min_topup instead of a fixed number.

create or replace function public.request_deposit(p_brand_id uuid, p_amount bigint)
returns table (deposit_id uuid, reference text, amount bigint, status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  c_max constant bigint := 50000000;
  c_pending_cap constant integer := 10;
  v_min bigint;
  v_user uuid := auth.uid();
  v_row ledger.deposits;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_brand_id is null or public.can_manage_brand(p_brand_id) is not true then
    raise exception 'not allowed to deposit for this brand'
      using errcode = 'insufficient_privilege';
  end if;

  select ps.min_topup into v_min from public.platform_settings ps where ps.id = true;
  v_min := coalesce(v_min, 10000);

  if p_amount is null or p_amount < v_min or p_amount > c_max then
    raise exception 'deposit amount must be between % and % TZS', v_min, c_max
      using errcode = 'check_violation';
  end if;

  -- One request at a time per brand, so the pending limit holds under concurrency.
  perform pg_advisory_xact_lock(hashtextextended('deposit:' || p_brand_id::text, 0));

  if (
    select count(*)
    from ledger.deposits d
    where d.brand_id = p_brand_id
      and d.status = 'pending'
      and d.created_at > now() - interval '1 day'
  ) >= c_pending_cap then
    raise exception 'too many pending deposits for this brand'
      using errcode = 'check_violation';
  end if;

  insert into ledger.deposits (brand_id, amount, reference, requested_by)
  values (
    p_brand_id,
    p_amount,
    'BD' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
    v_user
  )
  returning * into v_row;

  return query select v_row.id, v_row.reference, v_row.amount, v_row.status;
end;
$function$;