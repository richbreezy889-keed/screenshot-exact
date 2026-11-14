-- Wallet and ledger, phase 2a: brand deposits.
-- A deposit is requested by a brand member, confirmed by Selcom (server side only),
-- and only then does the ledger move money into the brand's wallet.

create table ledger.deposits (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete restrict,
  amount bigint not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'failed', 'expired')),
  reference text not null check (char_length(reference) between 10 and 40),
  provider text not null default 'selcom',
  provider_ref text check (provider_ref is null or char_length(btrim(provider_ref)) between 1 and 200),
  ledger_transaction_id uuid references ledger.transactions (id) on delete restrict,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint deposits_reference_key unique (reference),
  constraint deposits_confirmed_check check (
    status <> 'confirmed'
    or (provider_ref is not null and ledger_transaction_id is not null and confirmed_at is not null)
  )
);

create unique index deposits_provider_ref_key
  on ledger.deposits (provider, provider_ref)
  where provider_ref is not null;
create index deposits_brand_id_idx on ledger.deposits (brand_id, created_at desc);
create index deposits_ledger_transaction_id_idx on ledger.deposits (ledger_transaction_id);
create index deposits_requested_by_idx on ledger.deposits (requested_by);

alter table ledger.deposits enable row level security;
revoke all on ledger.deposits from public, anon, authenticated, service_role;

create function ledger.guard_deposit_changes()
returns trigger
language plpgsql
set search_path to 'ledger', 'pg_catalog'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'deposits cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  if new.id is distinct from old.id
    or new.brand_id is distinct from old.brand_id
    or new.amount is distinct from old.amount
    or new.reference is distinct from old.reference
    or new.created_at is distinct from old.created_at
    or (new.requested_by is distinct from old.requested_by and new.requested_by is not null)
    or (old.provider_ref is not null and new.provider_ref is distinct from old.provider_ref)
    or (old.ledger_transaction_id is not null
        and new.ledger_transaction_id is distinct from old.ledger_transaction_id)
  then
    raise exception 'deposit details cannot change'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'pending' and new.status in ('confirmed', 'failed', 'expired'))
      or (old.status = 'expired' and new.status = 'confirmed')
    )
  then
    raise exception 'invalid deposit status change from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger deposits_guard
  before update or delete on ledger.deposits
  for each row execute function ledger.guard_deposit_changes();

create trigger deposits_no_truncate
  before truncate on ledger.deposits
  for each statement execute function ledger.forbid_truncate();

revoke all on all functions in schema ledger from public, anon, authenticated, service_role;

-- A brand owner or manager asks to top up. Returns the reference to give to Selcom.
create or replace function public.request_deposit(p_brand_id uuid, p_amount bigint)
returns table (deposit_id uuid, reference text, amount bigint, status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  c_min constant bigint := 1000;
  c_max constant bigint := 50000000;
  c_pending_cap constant integer := 10;
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

  if p_amount is null or p_amount < c_min or p_amount > c_max then
    raise exception 'deposit amount must be between % and % TZS', c_min, c_max
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

-- Selcom confirms a payment. Safe to repeat: the same message credits once.
create or replace function public.confirm_deposit(
  p_reference text,
  p_provider_ref text,
  p_amount bigint,
  p_provider text default 'selcom'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d ledger.deposits;
  v_selcom uuid;
  v_wallet uuid;
  v_txn uuid;
begin
  if p_provider_ref is null or btrim(p_provider_ref) = '' then
    raise exception 'a provider reference is required'
      using errcode = 'check_violation';
  end if;

  select * into d from ledger.deposits where reference = p_reference for update;

  if not found then
    raise exception 'unknown deposit reference'
      using errcode = 'P0002';
  end if;

  if p_amount is distinct from d.amount then
    raise exception 'deposit amount mismatch: expected %, got %', d.amount, p_amount
      using errcode = 'check_violation';
  end if;

  if d.status = 'confirmed' then
    if d.provider_ref is distinct from p_provider_ref then
      raise exception 'deposit already confirmed with a different provider reference'
        using errcode = 'unique_violation';
    end if;
    return d.ledger_transaction_id;
  end if;

  if d.status = 'failed' then
    raise exception 'deposit was marked failed and needs manual review'
      using errcode = 'check_violation';
  end if;

  -- Pending, or expired with a late payment: money Selcom received is never refused.
  v_selcom := public.ledger_ensure_account('selcom_holdings');
  v_wallet := public.ledger_ensure_account('brand_wallet', d.brand_id);

  v_txn := public.ledger_post(
    'deposit',
    'deposit:' || d.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_selcom, 'side', 'debit', 'amount', d.amount),
      jsonb_build_object('account_id', v_wallet, 'side', 'credit', 'amount', d.amount)
    ),
    'deposit ' || d.reference
  );

  update ledger.deposits
  set status = 'confirmed',
      provider = coalesce(p_provider, 'selcom'),
      provider_ref = p_provider_ref,
      ledger_transaction_id = v_txn,
      confirmed_at = now(),
      updated_at = now()
  where id = d.id;

  return v_txn;
end;
$function$;

-- Selcom reports a payment failed. Only a pending deposit can fail.
create or replace function public.fail_deposit(p_reference text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d ledger.deposits;
begin
  select * into d from ledger.deposits where reference = p_reference for update;

  if not found then
    raise exception 'unknown deposit reference'
      using errcode = 'P0002';
  end if;

  if d.status = 'confirmed' then
    raise exception 'a confirmed deposit cannot be failed'
      using errcode = 'check_violation';
  end if;

  if d.status in ('failed', 'expired') then
    return d.status;
  end if;

  update ledger.deposits
  set status = 'failed',
      failure_reason = left(p_reason, 500),
      updated_at = now()
  where id = d.id;

  return 'failed';
end;
$function$;

-- Run on a schedule later. Pending deposits older than the limit become expired.
create or replace function public.expire_stale_deposits(p_older_than interval default interval '24 hours')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  update ledger.deposits
  set status = 'expired', updated_at = now()
  where status = 'pending'
    and created_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Any member of the brand (and admins) can see the wallet balance and deposit history.
create or replace function public.brand_wallet_summary(p_brand_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not (public.is_brand_member(p_brand_id) or public.is_admin()) then
    raise exception 'not allowed to view this brand''s wallet'
      using errcode = 'insufficient_privilege';
  end if;

  return coalesce((
    select a.balance
    from ledger.accounts a
    where a.brand_id = p_brand_id and a.kind = 'brand_wallet'
  ), 0);
end;
$function$;

create or replace function public.list_brand_deposits(p_brand_id uuid, p_limit integer default 50)
returns table (
  deposit_id uuid,
  amount bigint,
  status text,
  reference text,
  created_at timestamptz,
  confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null or not (public.is_brand_member(p_brand_id) or public.is_admin()) then
    raise exception 'not allowed to view this brand''s wallet'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select d.id, d.amount, d.status, d.reference, d.created_at, d.confirmed_at
  from ledger.deposits d
  where d.brand_id = p_brand_id
  order by d.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;

revoke all on function public.request_deposit(uuid, bigint) from public, anon;
revoke all on function public.confirm_deposit(text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.fail_deposit(text, text) from public, anon, authenticated;
revoke all on function public.expire_stale_deposits(interval) from public, anon, authenticated;
revoke all on function public.brand_wallet_summary(uuid) from public, anon;
revoke all on function public.list_brand_deposits(uuid, integer) from public, anon;

grant execute on function public.request_deposit(uuid, bigint) to authenticated, service_role;
grant execute on function public.confirm_deposit(text, text, bigint, text) to service_role;
grant execute on function public.fail_deposit(text, text) to service_role;
grant execute on function public.expire_stale_deposits(interval) to service_role;
grant execute on function public.brand_wallet_summary(uuid) to authenticated, service_role;
grant execute on function public.list_brand_deposits(uuid, integer) to authenticated, service_role;