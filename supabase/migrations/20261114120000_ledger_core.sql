-- Wallet and ledger, phase 1: an append-only double-entry ledger.
-- It lives in its own schema, which the API never exposes. Apps cannot touch it;
-- only the three server functions at the bottom (service_role) can post to it.

create schema if not exists ledger;
revoke all on schema ledger from public, anon, authenticated, service_role;

create table ledger.accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  brand_id uuid references public.brands (id) on delete restrict,
  campaign_id uuid references public.campaigns (id) on delete restrict,
  creator_id uuid references public.creators (id) on delete restrict,
  normal_side text generated always as (
    case when kind = 'selcom_holdings' then 'debit' else 'credit' end
  ) stored,
  owner_key text generated always as (
    kind || ':' || coalesce(brand_id::text, campaign_id::text, creator_id::text, 'platform')
  ) stored,
  balance bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint accounts_kind_check check (kind in (
    'selcom_holdings', 'brand_wallet', 'campaign_escrow', 'creator_pending',
    'creator_payable', 'payout_in_transit', 'platform_fees'
  )),
  constraint accounts_owner_check check (
    case kind
      when 'brand_wallet' then brand_id is not null and campaign_id is null and creator_id is null
      when 'campaign_escrow' then campaign_id is not null and brand_id is null and creator_id is null
      when 'creator_pending' then creator_id is not null and brand_id is null and campaign_id is null
      when 'creator_payable' then creator_id is not null and brand_id is null and campaign_id is null
      else brand_id is null and campaign_id is null and creator_id is null
    end
  ),
  constraint accounts_balance_check check (balance >= 0),
  constraint accounts_owner_key_key unique (owner_key)
);

create index accounts_brand_id_idx on ledger.accounts (brand_id);
create index accounts_campaign_id_idx on ledger.accounts (campaign_id);
create index accounts_creator_id_idx on ledger.accounts (creator_id);

create table ledger.transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(btrim(kind)) between 1 and 60),
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  content_hash text not null,
  memo text check (memo is null or char_length(memo) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint transactions_idempotency_key_key unique (idempotency_key)
);

create table ledger.entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references ledger.transactions (id) on delete restrict,
  account_id uuid not null references ledger.accounts (id) on delete restrict,
  side text not null check (side in ('debit', 'credit')),
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index entries_transaction_id_idx on ledger.entries (transaction_id);
create index entries_account_id_idx on ledger.entries (account_id);

alter table ledger.accounts enable row level security;
alter table ledger.transactions enable row level security;
alter table ledger.entries enable row level security;

-- Keeps each account's balance in step with its entries, in the same statement.
create function ledger.apply_entry_to_balance()
returns trigger
language plpgsql
security definer
set search_path to 'ledger', 'pg_catalog'
as $function$
begin
  update ledger.accounts a
  set balance = a.balance + case when new.side = a.normal_side then new.amount else -new.amount end
  where a.id = new.account_id;
  return null;
end;
$function$;

-- Accounts keep their identity, are never deleted, and change balance only through entries.
create function ledger.guard_account_changes()
returns trigger
language plpgsql
set search_path to 'ledger', 'pg_catalog'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'ledger accounts cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  if new.id is distinct from old.id
    or new.kind is distinct from old.kind
    or new.brand_id is distinct from old.brand_id
    or new.campaign_id is distinct from old.campaign_id
    or new.creator_id is distinct from old.creator_id
  then
    raise exception 'ledger account identity cannot change'
      using errcode = 'insufficient_privilege';
  end if;

  if new.balance is distinct from old.balance and pg_trigger_depth() < 2 then
    raise exception 'ledger balances change only through ledger entries'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$function$;

create function ledger.forbid_changes()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  raise exception 'the ledger is append-only'
    using errcode = 'insufficient_privilege';
  return null;
end;
$function$;

create function ledger.forbid_truncate()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  raise exception 'the ledger is append-only'
    using errcode = 'insufficient_privilege';
  return null;
end;
$function$;

-- Backstop for any direct write: every transaction must balance when it commits.
create function ledger.check_transaction_balanced()
returns trigger
language plpgsql
set search_path to 'ledger', 'pg_catalog'
as $function$
declare
  diff bigint;
begin
  select coalesce(sum(case e.side when 'debit' then e.amount else -e.amount end), 0)
  into diff
  from ledger.entries e
  where e.transaction_id = new.transaction_id;

  if diff <> 0 then
    raise exception 'ledger transaction % does not balance (off by %)', new.transaction_id, diff
      using errcode = 'check_violation';
  end if;

  return null;
end;
$function$;

create trigger accounts_guard
  before update or delete on ledger.accounts
  for each row execute function ledger.guard_account_changes();

create trigger entries_append_only
  before update or delete on ledger.entries
  for each row execute function ledger.forbid_changes();

create trigger transactions_append_only
  before update or delete on ledger.transactions
  for each row execute function ledger.forbid_changes();

create trigger entries_no_truncate
  before truncate on ledger.entries
  for each statement execute function ledger.forbid_truncate();

create trigger transactions_no_truncate
  before truncate on ledger.transactions
  for each statement execute function ledger.forbid_truncate();

create trigger accounts_no_truncate
  before truncate on ledger.accounts
  for each statement execute function ledger.forbid_truncate();

create trigger entries_apply_balance
  after insert on ledger.entries
  for each row execute function ledger.apply_entry_to_balance();

create constraint trigger entries_balanced
  after insert on ledger.entries
  deferrable initially deferred
  for each row execute function ledger.check_transaction_balanced();

-- Nothing in the ledger schema is reachable by any API role.
revoke all on all tables in schema ledger from public, anon, authenticated, service_role;
revoke all on all sequences in schema ledger from public, anon, authenticated, service_role;
revoke all on all functions in schema ledger from public, anon, authenticated, service_role;

-- Server functions (service_role only) ----------------------------------------

create or replace function public.ledger_ensure_account(
  p_kind text,
  p_brand_id uuid default null,
  p_campaign_id uuid default null,
  p_creator_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_key text;
begin
  v_key := p_kind || ':' || coalesce(p_brand_id::text, p_campaign_id::text, p_creator_id::text, 'platform');

  insert into ledger.accounts (kind, brand_id, campaign_id, creator_id)
  values (p_kind, p_brand_id, p_campaign_id, p_creator_id)
  on conflict (owner_key) do nothing
  returning id into v_id;

  if v_id is null then
    select a.id into v_id from ledger.accounts a where a.owner_key = v_key;
  end if;

  return v_id;
end;
$function$;

-- p_lines is a JSON array of {"account_id": uuid, "side": "debit"|"credit", "amount": whole TZS}.
create or replace function public.ledger_post(
  p_kind text,
  p_idempotency_key text,
  p_lines jsonb,
  p_memo text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_kind text := btrim(coalesce(p_kind, ''));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_hash text;
  v_txn uuid;
  v_existing_hash text;
  v_debits bigint;
  v_credits bigint;
begin
  if v_kind = '' or v_key = '' then
    raise exception 'a ledger transaction needs a kind and an idempotency key'
      using errcode = 'check_violation';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'a ledger transaction needs at least two lines'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e) <> 'object'
      or e->>'account_id' is null
      or coalesce(e->>'side', '') not in ('debit', 'credit')
      or case when e->>'amount' ~ '^[0-9]{1,15}$' then (e->>'amount')::bigint else 0 end <= 0
  ) then
    raise exception 'each line needs an account, a side of debit or credit, and a whole positive amount'
      using errcode = 'check_violation';
  end if;

  if (select count(distinct e->>'account_id') from jsonb_array_elements(p_lines) e)
     <> jsonb_array_length(p_lines) then
    raise exception 'an account may appear only once in a transaction'
      using errcode = 'check_violation';
  end if;

  select
    coalesce(sum(case when e->>'side' = 'debit' then (e->>'amount')::bigint end), 0),
    coalesce(sum(case when e->>'side' = 'credit' then (e->>'amount')::bigint end), 0)
  into v_debits, v_credits
  from jsonb_array_elements(p_lines) e;

  if v_debits <> v_credits then
    raise exception 'ledger transaction does not balance: debits % credits %', v_debits, v_credits
      using errcode = 'check_violation';
  end if;

  v_hash := md5(v_kind || '|' || p_lines::text);

  insert into ledger.transactions (kind, idempotency_key, content_hash, memo)
  values (v_kind, v_key, v_hash, p_memo)
  on conflict (idempotency_key) do nothing
  returning id into v_txn;

  if v_txn is null then
    select t.id, t.content_hash into v_txn, v_existing_hash
    from ledger.transactions t
    where t.idempotency_key = v_key;

    if v_existing_hash is distinct from v_hash then
      raise exception 'idempotency key already used with different content'
        using errcode = 'unique_violation';
    end if;

    return v_txn;
  end if;

  -- Lock the accounts in a fixed order so two transactions can never deadlock.
  perform 1
  from ledger.accounts a
  where a.id in (select (e->>'account_id')::uuid from jsonb_array_elements(p_lines) e)
  order by a.id
  for update;

  insert into ledger.entries (transaction_id, account_id, side, amount)
  select v_txn, (e->>'account_id')::uuid, e->>'side', (e->>'amount')::bigint
  from jsonb_array_elements(p_lines) e;

  return v_txn;
end;
$function$;

create or replace function public.ledger_balance(p_account_id uuid)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.balance from ledger.accounts a where a.id = p_account_id;
$function$;

create or replace function public.ledger_integrity_report()
returns table (check_name text, ok boolean, detail text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select 'every transaction balances'::text,
         count(*) = 0,
         ('unbalanced transactions: ' || count(*))::text
  from (
    select e.transaction_id
    from ledger.entries e
    group by e.transaction_id
    having sum(case e.side when 'debit' then e.amount else -e.amount end) <> 0
  ) bad
  union all
  select 'every transaction has at least two entries'::text,
         count(*) = 0,
         ('transactions with fewer than two entries: ' || count(*))::text
  from ledger.transactions t
  where (select count(*) from ledger.entries e where e.transaction_id = t.id) < 2
  union all
  select 'stored balances match the entries'::text,
         count(*) = 0,
         ('accounts with a wrong balance: ' || count(*))::text
  from ledger.accounts a
  where a.balance <> coalesce((
    select sum(case when e.side = a.normal_side then e.amount else -e.amount end)
    from ledger.entries e
    where e.account_id = a.id
  ), 0)
  union all
  select 'Selcom holdings equal everything owed'::text,
         h.held = o.owed,
         ('held ' || h.held || ', owed ' || o.owed)::text
  from (select coalesce(sum(balance), 0) as held from ledger.accounts where kind = 'selcom_holdings') h,
       (select coalesce(sum(balance), 0) as owed from ledger.accounts where kind <> 'selcom_holdings') o;
$function$;

revoke all on function public.ledger_ensure_account(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ledger_post(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.ledger_balance(uuid) from public, anon, authenticated;
revoke all on function public.ledger_integrity_report() from public, anon, authenticated;

grant execute on function public.ledger_ensure_account(text, uuid, uuid, uuid) to service_role;
grant execute on function public.ledger_post(text, text, jsonb, text) to service_role;
grant execute on function public.ledger_balance(uuid) to service_role;
grant execute on function public.ledger_integrity_report() to service_role;