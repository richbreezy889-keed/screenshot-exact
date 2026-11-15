-- Wallet and ledger, phase 2d: cancelling and closing campaigns, brand withdrawals.

alter type public.campaign_status add value if not exists 'completed';
alter type public.campaign_status add value if not exists 'cancelled';

create table ledger.campaign_cancellations (
  campaign_id uuid primary key references public.campaigns (id) on delete restrict,
  cancelled_by uuid references public.profiles (id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  cancelled_at timestamptz not null default now()
);

create index campaign_cancellations_cancelled_by_idx on ledger.campaign_cancellations (cancelled_by);

create table ledger.campaign_closures (
  campaign_id uuid primary key references public.campaigns (id) on delete restrict,
  returned bigint not null check (returned >= 0),
  ledger_transaction_id uuid references ledger.transactions (id) on delete restrict,
  closed_at timestamptz not null default now(),
  constraint campaign_closures_transaction_check check ((returned = 0) = (ledger_transaction_id is null))
);

create index campaign_closures_ledger_transaction_id_idx on ledger.campaign_closures (ledger_transaction_id);

create table ledger.brand_withdrawals (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete restrict,
  amount bigint not null check (amount > 0),
  destination text not null check (destination ~ '^255[67][0-9]{8}$'),
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'failed')),
  reference text not null check (char_length(reference) between 10 and 40),
  provider text not null default 'selcom',
  provider_ref text check (provider_ref is null or char_length(btrim(provider_ref)) between 1 and 200),
  request_transaction_id uuid not null references ledger.transactions (id) on delete restrict,
  settle_transaction_id uuid references ledger.transactions (id) on delete restrict,
  requested_by uuid references public.profiles (id) on delete set null,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint brand_withdrawals_reference_key unique (reference),
  constraint brand_withdrawals_settled_check check (status = 'requested' or settle_transaction_id is not null),
  constraint brand_withdrawals_confirmed_check check (status <> 'confirmed' or provider_ref is not null)
);

create unique index brand_withdrawals_provider_ref_key
  on ledger.brand_withdrawals (provider, provider_ref)
  where provider_ref is not null;
create index brand_withdrawals_brand_id_idx on ledger.brand_withdrawals (brand_id, created_at desc);
create index brand_withdrawals_request_transaction_id_idx on ledger.brand_withdrawals (request_transaction_id);
create index brand_withdrawals_settle_transaction_id_idx on ledger.brand_withdrawals (settle_transaction_id);
create index brand_withdrawals_requested_by_idx on ledger.brand_withdrawals (requested_by);

alter table ledger.campaign_cancellations enable row level security;
alter table ledger.campaign_closures enable row level security;
alter table ledger.brand_withdrawals enable row level security;
revoke all on ledger.campaign_cancellations from public, anon, authenticated, service_role;
revoke all on ledger.campaign_closures from public, anon, authenticated, service_role;
revoke all on ledger.brand_withdrawals from public, anon, authenticated, service_role;

create function ledger.guard_cancellation_changes()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'cancellations cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  if new.campaign_id is distinct from old.campaign_id
    or new.reason is distinct from old.reason
    or new.cancelled_at is distinct from old.cancelled_at
    or (new.cancelled_by is distinct from old.cancelled_by and new.cancelled_by is not null)
  then
    raise exception 'cancellation details cannot change'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$function$;

create function ledger.guard_withdrawal_changes()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'withdrawals cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  if new.id is distinct from old.id
    or new.brand_id is distinct from old.brand_id
    or new.amount is distinct from old.amount
    or new.destination is distinct from old.destination
    or new.reference is distinct from old.reference
    or new.created_at is distinct from old.created_at
    or new.request_transaction_id is distinct from old.request_transaction_id
    or (new.requested_by is distinct from old.requested_by and new.requested_by is not null)
    or (old.provider_ref is not null and new.provider_ref is distinct from old.provider_ref)
    or (old.settle_transaction_id is not null
        and new.settle_transaction_id is distinct from old.settle_transaction_id)
  then
    raise exception 'withdrawal details cannot change'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status
    and not (old.status = 'requested' and new.status in ('confirmed', 'failed'))
  then
    raise exception 'invalid withdrawal status change from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger campaign_cancellations_guard
  before update or delete on ledger.campaign_cancellations
  for each row execute function ledger.guard_cancellation_changes();

create trigger campaign_closures_append_only
  before update or delete on ledger.campaign_closures
  for each row execute function ledger.forbid_changes();

create trigger brand_withdrawals_guard
  before update or delete on ledger.brand_withdrawals
  for each row execute function ledger.guard_withdrawal_changes();

create trigger campaign_cancellations_no_truncate
  before truncate on ledger.campaign_cancellations
  for each statement execute function ledger.forbid_truncate();

create trigger campaign_closures_no_truncate
  before truncate on ledger.campaign_closures
  for each statement execute function ledger.forbid_truncate();

create trigger brand_withdrawals_no_truncate
  before truncate on ledger.brand_withdrawals
  for each statement execute function ledger.forbid_truncate();

-- Closes a funded campaign once everything on it is settled, returning what is left in escrow.
-- Returns 'closed', 'waiting' (not yet allowed) or 'skipped' (not a funded campaign).
create function ledger.try_close_campaign(p_campaign_id uuid)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  c record;
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_escrow uuid;
  v_balance bigint;
  v_wallet uuid;
  v_txn uuid;
begin
  select cam.id, cam.brand_id, cam.status::text as status, cam.deadline
  into c
  from public.campaigns cam
  where cam.id = p_campaign_id
  for update;

  if not found then
    return 'skipped';
  end if;

  if exists (select 1 from ledger.campaign_closures cc where cc.campaign_id = c.id) then
    return 'closed';
  end if;

  if not exists (select 1 from ledger.campaign_funding cf where cf.campaign_id = c.id) then
    return 'skipped';
  end if;

  if not (c.status = 'cancelled' or (c.status = 'live' and c.deadline < v_today)) then
    return 'waiting';
  end if;

  -- A video being posted right now holds its application's lock, so either we see it
  -- below or it waits and finds the campaign no longer live.
  perform 1 from public.applications a where a.campaign_id = c.id for update;

  if exists (
    select 1
    from public.submissions s
    join public.view_checkpoints vc on vc.submission_id = s.id
    where s.campaign_id = c.id
      and s.status::text <> 'rejected'
      and vc.status::text <> 'verified'
  ) then
    return 'waiting';
  end if;

  if exists (
    select 1
    from ledger.checkpoint_accruals x
    where x.campaign_id = c.id and x.status in ('held', 'flagged')
  ) then
    return 'waiting';
  end if;

  select a.id, a.balance
  into v_escrow, v_balance
  from ledger.accounts a
  where a.owner_key = 'campaign_escrow:' || c.id::text;

  if coalesce(v_balance, 0) > 0 then
    v_wallet := public.ledger_ensure_account('brand_wallet', c.brand_id);
    v_txn := public.ledger_post(
      'campaign_close',
      'close:' || c.id::text,
      jsonb_build_array(
        jsonb_build_object('account_id', v_escrow, 'side', 'debit', 'amount', v_balance),
        jsonb_build_object('account_id', v_wallet, 'side', 'credit', 'amount', v_balance)
      ),
      null
    );
  end if;

  insert into ledger.campaign_closures (campaign_id, returned, ledger_transaction_id)
  values (c.id, coalesce(v_balance, 0), v_txn);

  if c.status = 'live' then
    update public.campaigns set status = 'completed' where id = c.id;
  end if;

  return 'closed';
end;
$function$;

revoke all on all functions in schema ledger from public, anon, authenticated, service_role;

-- A brand owner or manager cancels a live campaign within 48 hours of launch.
create or replace function public.cancel_campaign(p_campaign_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  c record;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_campaign_id is null or public.can_manage_campaign(p_campaign_id) is not true then
    raise exception 'not allowed to cancel this campaign'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required'
      using errcode = 'check_violation';
  end if;

  select cam.id, cam.status::text as status, cam.published_at
  into c
  from public.campaigns cam
  where cam.id = p_campaign_id
  for update;

  if c.status = 'cancelled' then
    return 'cancelled';
  end if;

  if c.status <> 'live' then
    raise exception 'only a live campaign can be cancelled'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from ledger.campaign_funding cf where cf.campaign_id = c.id) then
    raise exception 'this campaign was published before funding was tracked'
      using errcode = 'check_violation';
  end if;

  if c.published_at is null or now() > c.published_at + interval '48 hours' then
    raise exception 'the 48-hour cancellation window has ended'
      using errcode = 'check_violation';
  end if;

  update public.campaigns set status = 'cancelled' where id = c.id;

  insert into ledger.campaign_cancellations (campaign_id, cancelled_by, reason)
  values (c.id, v_user, btrim(p_reason));

  perform ledger.try_close_campaign(c.id);

  return 'cancelled';
end;
$function$;

-- Run on a schedule: closes every campaign that is due and fully settled.
create or replace function public.close_due_campaigns(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_count integer := 0;
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
begin
  for r in
    select c.id
    from public.campaigns c
    where exists (select 1 from ledger.campaign_funding cf where cf.campaign_id = c.id)
      and not exists (select 1 from ledger.campaign_closures cc where cc.campaign_id = c.id)
      and (c.status::text = 'cancelled' or (c.status::text = 'live' and c.deadline < v_today))
    order by c.deadline
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update of c skip locked
  loop
    if ledger.try_close_campaign(r.id) = 'closed' then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;

-- A brand owner withdraws money from the wallet to a mobile number.
create or replace function public.request_brand_withdrawal(
  p_brand_id uuid,
  p_amount bigint,
  p_destination text
)
returns table (withdrawal_id uuid, reference text, amount bigint, destination text, status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  c_min constant bigint := 1000;
  c_max constant bigint := 50000000;
  c_open_cap constant integer := 5;
  v_user uuid := auth.uid();
  v_dest text;
  v_id uuid := gen_random_uuid();
  v_ref text;
  v_wallet uuid;
  v_transit uuid;
  v_balance bigint;
  v_txn uuid;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_brand_id is null or coalesce(public.brand_role(p_brand_id)::text, '') <> 'owner' then
    raise exception 'only the brand owner can withdraw'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount < c_min or p_amount > c_max then
    raise exception 'withdrawal amount must be between % and % TZS', c_min, c_max
      using errcode = 'check_violation';
  end if;

  v_dest := regexp_replace(coalesce(p_destination, ''), '[\s-]', '', 'g');
  if v_dest ~ '^\+255[67][0-9]{8}$' then
    v_dest := substr(v_dest, 2);
  elsif v_dest ~ '^0[67][0-9]{8}$' then
    v_dest := '255' || substr(v_dest, 2);
  end if;
  if v_dest !~ '^255[67][0-9]{8}$' then
    raise exception 'enter a valid Tanzanian mobile number'
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('withdraw:' || p_brand_id::text, 0));

  if (
    select count(*)
    from ledger.brand_withdrawals w
    where w.brand_id = p_brand_id and w.status = 'requested'
  ) >= c_open_cap then
    raise exception 'too many open withdrawals, wait for the current ones to finish'
      using errcode = 'check_violation';
  end if;

  v_wallet := public.ledger_ensure_account('brand_wallet', p_brand_id);
  v_transit := public.ledger_ensure_account('payout_in_transit');

  v_balance := public.ledger_balance(v_wallet);
  if v_balance < p_amount then
    raise exception 'insufficient wallet balance: have % TZS', v_balance
      using errcode = 'check_violation';
  end if;

  v_ref := 'BW' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

  v_txn := public.ledger_post(
    'brand_withdrawal_request',
    'withdrawal:' || v_id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_wallet, 'side', 'debit', 'amount', p_amount),
      jsonb_build_object('account_id', v_transit, 'side', 'credit', 'amount', p_amount)
    ),
    'withdrawal ' || v_ref
  );

  insert into ledger.brand_withdrawals (
    id, brand_id, amount, destination, reference, request_transaction_id, requested_by
  )
  values (v_id, p_brand_id, p_amount, v_dest, v_ref, v_txn, v_user);

  return query select v_id, v_ref, p_amount, v_dest, 'requested'::text;
end;
$function$;

-- Selcom confirms the money reached the brand. Safe to repeat.
create or replace function public.confirm_brand_withdrawal(
  p_reference text,
  p_provider_ref text,
  p_provider text default 'selcom'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  w ledger.brand_withdrawals;
  v_transit uuid;
  v_selcom uuid;
  v_txn uuid;
begin
  if p_provider_ref is null or btrim(p_provider_ref) = '' then
    raise exception 'a provider reference is required'
      using errcode = 'check_violation';
  end if;

  select * into w from ledger.brand_withdrawals where reference = p_reference for update;

  if not found then
    raise exception 'unknown withdrawal reference'
      using errcode = 'P0002';
  end if;

  if w.status = 'confirmed' then
    if w.provider_ref is distinct from p_provider_ref then
      raise exception 'withdrawal already confirmed with a different provider reference'
        using errcode = 'unique_violation';
    end if;
    return w.settle_transaction_id;
  end if;

  if w.status = 'failed' then
    raise exception 'withdrawal was marked failed and needs manual review'
      using errcode = 'check_violation';
  end if;

  v_transit := public.ledger_ensure_account('payout_in_transit');
  v_selcom := public.ledger_ensure_account('selcom_holdings');

  v_txn := public.ledger_post(
    'brand_withdrawal_settle',
    'withdrawal-settle:' || w.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_transit, 'side', 'debit', 'amount', w.amount),
      jsonb_build_object('account_id', v_selcom, 'side', 'credit', 'amount', w.amount)
    ),
    'withdrawal ' || w.reference
  );

  update ledger.brand_withdrawals
  set status = 'confirmed',
      provider = coalesce(p_provider, 'selcom'),
      provider_ref = p_provider_ref,
      settle_transaction_id = v_txn,
      settled_at = now(),
      updated_at = now()
  where id = w.id;

  return v_txn;
end;
$function$;

-- Selcom reports the withdrawal failed: the money goes back to the brand's wallet.
create or replace function public.fail_brand_withdrawal(p_reference text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  w ledger.brand_withdrawals;
  v_transit uuid;
  v_wallet uuid;
  v_txn uuid;
begin
  select * into w from ledger.brand_withdrawals where reference = p_reference for update;

  if not found then
    raise exception 'unknown withdrawal reference'
      using errcode = 'P0002';
  end if;

  if w.status = 'confirmed' then
    raise exception 'a confirmed withdrawal cannot be failed'
      using errcode = 'check_violation';
  end if;

  if w.status = 'failed' then
    return 'failed';
  end if;

  v_transit := public.ledger_ensure_account('payout_in_transit');
  v_wallet := public.ledger_ensure_account('brand_wallet', w.brand_id);

  v_txn := public.ledger_post(
    'brand_withdrawal_failed',
    'withdrawal-fail:' || w.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_transit, 'side', 'debit', 'amount', w.amount),
      jsonb_build_object('account_id', v_wallet, 'side', 'credit', 'amount', w.amount)
    ),
    'withdrawal ' || w.reference
  );

  update ledger.brand_withdrawals
  set status = 'failed',
      settle_transaction_id = v_txn,
      failure_reason = left(p_reason, 500),
      settled_at = now(),
      updated_at = now()
  where id = w.id;

  return 'failed';
end;
$function$;

-- Any member of the brand (and admins) can see its withdrawals.
create or replace function public.list_brand_withdrawals(p_brand_id uuid, p_limit integer default 50)
returns table (
  withdrawal_id uuid,
  amount bigint,
  destination text,
  status text,
  reference text,
  created_at timestamptz,
  settled_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null or not (public.is_brand_member(p_brand_id) or public.is_admin()) then
    raise exception 'not allowed to view this brand''s withdrawals'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select w.id, w.amount, w.destination, w.status, w.reference, w.created_at, w.settled_at
  from ledger.brand_withdrawals w
  where w.brand_id = p_brand_id
  order by w.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;

revoke all on function public.cancel_campaign(uuid, text) from public, anon;
revoke all on function public.close_due_campaigns(integer) from public, anon, authenticated;
revoke all on function public.request_brand_withdrawal(uuid, bigint, text) from public, anon;
revoke all on function public.confirm_brand_withdrawal(text, text, text) from public, anon, authenticated;
revoke all on function public.fail_brand_withdrawal(text, text) from public, anon, authenticated;
revoke all on function public.list_brand_withdrawals(uuid, integer) from public, anon;

grant execute on function public.cancel_campaign(uuid, text) to authenticated;
grant execute on function public.close_due_campaigns(integer) to service_role;
grant execute on function public.request_brand_withdrawal(uuid, bigint, text) to authenticated;
grant execute on function public.confirm_brand_withdrawal(text, text, text) to service_role;
grant execute on function public.fail_brand_withdrawal(text, text) to service_role;
grant execute on function public.list_brand_withdrawals(uuid, integer) to authenticated;