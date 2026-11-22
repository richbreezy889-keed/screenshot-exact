-- Wallet and ledger, phase 2c: payouts to creators through Selcom.
-- A creator requests a payout from their released balance. The money moves to
-- "payout in transit" at once, then out of Selcom's holdings when Selcom confirms,
-- or back to the creator if Selcom reports a failure.

create table ledger.payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete restrict,
  amount bigint not null check (amount > 0),
  destination text not null check (destination ~ '^255[67][0-9]{8}$'),
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'failed')),
  reference text not null check (char_length(reference) between 10 and 40),
  provider text not null default 'selcom',
  provider_ref text check (provider_ref is null or char_length(btrim(provider_ref)) between 1 and 200),
  request_transaction_id uuid not null references ledger.transactions (id) on delete restrict,
  settle_transaction_id uuid references ledger.transactions (id) on delete restrict,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint payouts_reference_key unique (reference),
  constraint payouts_settled_check check (status = 'requested' or settle_transaction_id is not null),
  constraint payouts_confirmed_check check (status <> 'confirmed' or provider_ref is not null)
);

create unique index payouts_provider_ref_key
  on ledger.payouts (provider, provider_ref)
  where provider_ref is not null;
create index payouts_creator_id_idx on ledger.payouts (creator_id, created_at desc);
create index payouts_request_transaction_id_idx on ledger.payouts (request_transaction_id);
create index payouts_settle_transaction_id_idx on ledger.payouts (settle_transaction_id);

alter table ledger.payouts enable row level security;
revoke all on ledger.payouts from public, anon, authenticated, service_role;

create function ledger.guard_payout_changes()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'payouts cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  if new.id is distinct from old.id
    or new.creator_id is distinct from old.creator_id
    or new.amount is distinct from old.amount
    or new.destination is distinct from old.destination
    or new.reference is distinct from old.reference
    or new.created_at is distinct from old.created_at
    or new.request_transaction_id is distinct from old.request_transaction_id
    or (old.provider_ref is not null and new.provider_ref is distinct from old.provider_ref)
    or (old.settle_transaction_id is not null
        and new.settle_transaction_id is distinct from old.settle_transaction_id)
  then
    raise exception 'payout details cannot change'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status
    and not (old.status = 'requested' and new.status in ('confirmed', 'failed'))
  then
    raise exception 'invalid payout status change from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger payouts_guard
  before update or delete on ledger.payouts
  for each row execute function ledger.guard_payout_changes();

create trigger payouts_no_truncate
  before truncate on ledger.payouts
  for each statement execute function ledger.forbid_truncate();

revoke all on all functions in schema ledger from public, anon, authenticated, service_role;

-- A creator asks to withdraw part or all of their released balance.
create or replace function public.request_payout(p_amount bigint, p_destination text)
returns table (payout_id uuid, reference text, amount bigint, destination text, status text)
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
  v_payable uuid;
  v_transit uuid;
  v_balance bigint;
  v_txn uuid;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if public.is_creator() is not true then
    raise exception 'only creator accounts can request a payout'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.creators c where c.id = v_user) then
    raise exception 'complete your creator profile before requesting a payout'
      using errcode = 'check_violation';
  end if;

  if p_amount is null or p_amount < c_min or p_amount > c_max then
    raise exception 'payout amount must be between % and % TZS', c_min, c_max
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

  -- One request at a time per creator, so two requests cannot spend one balance twice.
  perform pg_advisory_xact_lock(hashtextextended('payout:' || v_user::text, 0));

  if (
    select count(*)
    from ledger.payouts p
    where p.creator_id = v_user and p.status = 'requested'
  ) >= c_open_cap then
    raise exception 'too many open payouts, wait for the current ones to finish'
      using errcode = 'check_violation';
  end if;

  v_payable := public.ledger_ensure_account('creator_payable', null, null, v_user);
  v_transit := public.ledger_ensure_account('payout_in_transit');

  v_balance := public.ledger_balance(v_payable);
  if v_balance < p_amount then
    raise exception 'insufficient payable balance: have % TZS', v_balance
      using errcode = 'check_violation';
  end if;

  v_ref := 'PO' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

  v_txn := public.ledger_post(
    'payout_request',
    'payout:' || v_id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_payable, 'side', 'debit', 'amount', p_amount),
      jsonb_build_object('account_id', v_transit, 'side', 'credit', 'amount', p_amount)
    ),
    'payout ' || v_ref
  );

  insert into ledger.payouts (id, creator_id, amount, destination, reference, request_transaction_id)
  values (v_id, v_user, p_amount, v_dest, v_ref, v_txn);

  return query select v_id, v_ref, p_amount, v_dest, 'requested'::text;
end;
$function$;

-- Selcom confirms the money reached the creator. Safe to repeat.
create or replace function public.confirm_payout(
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
  p ledger.payouts;
  v_transit uuid;
  v_selcom uuid;
  v_txn uuid;
begin
  if p_provider_ref is null or btrim(p_provider_ref) = '' then
    raise exception 'a provider reference is required'
      using errcode = 'check_violation';
  end if;

  select * into p from ledger.payouts where reference = p_reference for update;

  if not found then
    raise exception 'unknown payout reference'
      using errcode = 'P0002';
  end if;

  if p.status = 'confirmed' then
    if p.provider_ref is distinct from p_provider_ref then
      raise exception 'payout already confirmed with a different provider reference'
        using errcode = 'unique_violation';
    end if;
    return p.settle_transaction_id;
  end if;

  if p.status = 'failed' then
    raise exception 'payout was marked failed and needs manual review'
      using errcode = 'check_violation';
  end if;

  v_transit := public.ledger_ensure_account('payout_in_transit');
  v_selcom := public.ledger_ensure_account('selcom_holdings');

  v_txn := public.ledger_post(
    'payout_settle',
    'payout-settle:' || p.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_transit, 'side', 'debit', 'amount', p.amount),
      jsonb_build_object('account_id', v_selcom, 'side', 'credit', 'amount', p.amount)
    ),
    'payout ' || p.reference
  );

  update ledger.payouts
  set status = 'confirmed',
      provider = coalesce(p_provider, 'selcom'),
      provider_ref = p_provider_ref,
      settle_transaction_id = v_txn,
      settled_at = now(),
      updated_at = now()
  where id = p.id;

  return v_txn;
end;
$function$;

-- Selcom reports the payout failed: the money goes back to the creator's balance.
create or replace function public.fail_payout(p_reference text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p ledger.payouts;
  v_transit uuid;
  v_payable uuid;
  v_txn uuid;
begin
  select * into p from ledger.payouts where reference = p_reference for update;

  if not found then
    raise exception 'unknown payout reference'
      using errcode = 'P0002';
  end if;

  if p.status = 'confirmed' then
    raise exception 'a confirmed payout cannot be failed'
      using errcode = 'check_violation';
  end if;

  if p.status = 'failed' then
    return 'failed';
  end if;

  v_transit := public.ledger_ensure_account('payout_in_transit');
  v_payable := public.ledger_ensure_account('creator_payable', null, null, p.creator_id);

  v_txn := public.ledger_post(
    'payout_failed',
    'payout-fail:' || p.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_transit, 'side', 'debit', 'amount', p.amount),
      jsonb_build_object('account_id', v_payable, 'side', 'credit', 'amount', p.amount)
    ),
    'payout ' || p.reference
  );

  update ledger.payouts
  set status = 'failed',
      settle_transaction_id = v_txn,
      failure_reason = left(p_reason, 500),
      settled_at = now(),
      updated_at = now()
  where id = p.id;

  return 'failed';
end;
$function$;

-- A creator sees only their own payouts.
create or replace function public.list_my_payouts(p_limit integer default 50)
returns table (
  payout_id uuid,
  reference text,
  amount bigint,
  destination text,
  status text,
  created_at timestamptz,
  settled_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.reference, p.amount, p.destination, p.status, p.created_at, p.settled_at
  from ledger.payouts p
  where p.creator_id = auth.uid()
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

-- A creator sees their own balances: earned but on hold, ready to withdraw, and on its way.
create or replace function public.creator_balances()
returns table (pending bigint, payable bigint, in_flight bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    coalesce((select a.balance from ledger.accounts a
              where a.kind = 'creator_pending' and a.creator_id = auth.uid()), 0),
    coalesce((select a.balance from ledger.accounts a
              where a.kind = 'creator_payable' and a.creator_id = auth.uid()), 0),
    coalesce((select sum(p.amount) from ledger.payouts p
              where p.creator_id = auth.uid() and p.status = 'requested'), 0)::bigint;
$function$;

revoke all on function public.request_payout(bigint, text) from public, anon;
revoke all on function public.confirm_payout(text, text, text) from public, anon, authenticated;
revoke all on function public.fail_payout(text, text) from public, anon, authenticated;
revoke all on function public.list_my_payouts(integer) from public, anon;
revoke all on function public.creator_balances() from public, anon;

grant execute on function public.request_payout(bigint, text) to authenticated;
grant execute on function public.confirm_payout(text, text, text) to service_role;
grant execute on function public.fail_payout(text, text) to service_role;
grant execute on function public.list_my_payouts(integer) to authenticated;
grant execute on function public.creator_balances() to authenticated;