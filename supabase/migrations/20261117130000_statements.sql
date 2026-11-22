-- Wallet statements: read-only views of the ledger for the wallet screens.

create or replace function public.brand_wallet_statement(p_brand_id uuid, p_limit integer default 100)
returns table (
  entry_id bigint,
  occurred_at timestamptz,
  kind text,
  amount bigint,
  balance_after bigint,
  reference text,
  campaign_id uuid
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
  with moves as (
    select
      e.id as eid,
      t.created_at as occurred,
      t.kind as k,
      t.memo as m,
      t.id as tid,
      case when e.side = 'credit' then e.amount else -e.amount end as amt,
      sum(case when e.side = 'credit' then e.amount else -e.amount end) over (order by e.id) as bal
    from ledger.entries e
    join ledger.transactions t on t.id = e.transaction_id
    where e.account_id = (
      select a.id from ledger.accounts a
      where a.brand_id = p_brand_id and a.kind = 'brand_wallet'
    )
  )
  select
    m.eid,
    m.occurred,
    m.k,
    m.amt::bigint,
    m.bal::bigint,
    m.m,
    coalesce(cf.campaign_id, cc.campaign_id)
  from moves m
  left join ledger.campaign_funding cf on cf.ledger_transaction_id = m.tid
  left join ledger.campaign_closures cc on cc.ledger_transaction_id = m.tid
  order by m.eid desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;

create or replace function public.creator_statement(p_limit integer default 100)
returns table (
  entry_id bigint,
  occurred_at timestamptz,
  kind text,
  account text,
  amount bigint,
  balance_after bigint,
  reference text,
  campaign_id uuid
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with moves as (
    select
      e.id as eid,
      t.created_at as occurred,
      t.kind as k,
      t.memo as m,
      t.id as tid,
      a.kind as acct,
      case when e.side = 'credit' then e.amount else -e.amount end as amt,
      sum(case when e.side = 'credit' then e.amount else -e.amount end)
        over (partition by a.id order by e.id) as bal
    from ledger.accounts a
    join ledger.entries e on e.account_id = a.id
    join ledger.transactions t on t.id = e.transaction_id
    where a.creator_id = auth.uid()
      and a.kind in ('creator_pending', 'creator_payable')
  )
  select
    m.eid,
    m.occurred,
    m.k,
    m.acct,
    m.amt::bigint,
    m.bal::bigint,
    m.m,
    x.campaign_id
  from moves m
  left join ledger.checkpoint_accruals x
    on x.accrual_transaction_id = m.tid
    or x.release_transaction_id = m.tid
    or x.reversal_transaction_id = m.tid
  order by m.eid desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;

revoke all on function public.brand_wallet_statement(uuid, integer) from public, anon;
revoke all on function public.creator_statement(integer) from public, anon;

grant execute on function public.brand_wallet_statement(uuid, integer) to authenticated;
grant execute on function public.creator_statement(integer) to authenticated;