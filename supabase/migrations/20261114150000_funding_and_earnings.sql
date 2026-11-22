-- Wallet and ledger, phase 2b: funding a campaign, earnings when a checkpoint is
-- verified, the review hold, brand flags and admin decisions.

create table ledger.campaign_funding (
  campaign_id uuid primary key references public.campaigns (id) on delete restrict,
  brand_id uuid not null references public.brands (id) on delete restrict,
  budget bigint not null check (budget > 0),
  creator_cap bigint not null check (creator_cap >= 0),
  rate_per_1k bigint not null check (rate_per_1k > 0),
  fee_bps integer not null check (fee_bps between 0 and 10000),
  hold_hours integer not null check (hold_hours >= 0),
  ledger_transaction_id uuid not null references ledger.transactions (id) on delete restrict,
  funded_at timestamptz not null default now()
);

create index campaign_funding_brand_id_idx on ledger.campaign_funding (brand_id);
create index campaign_funding_ledger_transaction_id_idx on ledger.campaign_funding (ledger_transaction_id);

alter table ledger.campaign_funding enable row level security;
revoke all on ledger.campaign_funding from public, anon, authenticated, service_role;

create trigger campaign_funding_append_only
  before update or delete on ledger.campaign_funding
  for each row execute function ledger.forbid_changes();

create trigger campaign_funding_no_truncate
  before truncate on ledger.campaign_funding
  for each statement execute function ledger.forbid_truncate();

create table ledger.checkpoint_accruals (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references public.view_checkpoints (id) on delete restrict,
  submission_id uuid not null references public.submissions (id) on delete restrict,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  creator_id uuid not null references public.creators (id) on delete restrict,
  views bigint not null check (views >= 0),
  rate_per_1k bigint not null check (rate_per_1k > 0),
  creator_cap bigint not null check (creator_cap >= 0),
  gross bigint not null check (gross >= 0),
  fee bigint not null check (fee >= 0),
  net bigint not null check (net >= 0),
  fee_bps integer not null,
  status text not null check (status in ('held', 'flagged', 'released', 'reversed', 'void')),
  release_at timestamptz not null,
  accrual_transaction_id uuid references ledger.transactions (id) on delete restrict,
  release_transaction_id uuid references ledger.transactions (id) on delete restrict,
  reversal_transaction_id uuid references ledger.transactions (id) on delete restrict,
  flagged_by uuid references public.profiles (id) on delete set null,
  flagged_at timestamptz,
  flag_reason text check (flag_reason is null or char_length(flag_reason) <= 1000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),
  constraint checkpoint_accruals_checkpoint_id_key unique (checkpoint_id),
  constraint checkpoint_accruals_money_check check (gross = fee + net),
  constraint checkpoint_accruals_void_check check ((status = 'void') = (accrual_transaction_id is null))
);

create index checkpoint_accruals_submission_id_idx on ledger.checkpoint_accruals (submission_id);
create index checkpoint_accruals_campaign_id_idx on ledger.checkpoint_accruals (campaign_id);
create index checkpoint_accruals_creator_id_idx on ledger.checkpoint_accruals (creator_id);
create index checkpoint_accruals_accrual_txn_idx on ledger.checkpoint_accruals (accrual_transaction_id);
create index checkpoint_accruals_release_txn_idx on ledger.checkpoint_accruals (release_transaction_id);
create index checkpoint_accruals_reversal_txn_idx on ledger.checkpoint_accruals (reversal_transaction_id);
create index checkpoint_accruals_flagged_by_idx on ledger.checkpoint_accruals (flagged_by);
create index checkpoint_accruals_resolved_by_idx on ledger.checkpoint_accruals (resolved_by);
create index checkpoint_accruals_due_idx on ledger.checkpoint_accruals (status, release_at);

alter table ledger.checkpoint_accruals enable row level security;
revoke all on ledger.checkpoint_accruals from public, anon, authenticated, service_role;

create function ledger.guard_accrual_changes()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'accruals cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  if new.id is distinct from old.id
    or new.checkpoint_id is distinct from old.checkpoint_id
    or new.submission_id is distinct from old.submission_id
    or new.campaign_id is distinct from old.campaign_id
    or new.creator_id is distinct from old.creator_id
    or new.views is distinct from old.views
    or new.rate_per_1k is distinct from old.rate_per_1k
    or new.creator_cap is distinct from old.creator_cap
    or new.gross is distinct from old.gross
    or new.fee is distinct from old.fee
    or new.net is distinct from old.net
    or new.fee_bps is distinct from old.fee_bps
    or new.created_at is distinct from old.created_at
    or new.accrual_transaction_id is distinct from old.accrual_transaction_id
    or new.release_at > old.release_at
  then
    raise exception 'accrual details cannot change'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'held' and new.status in ('flagged', 'released'))
      or (old.status = 'flagged' and new.status in ('released', 'reversed'))
    )
  then
    raise exception 'invalid accrual status change from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger checkpoint_accruals_guard
  before update or delete on ledger.checkpoint_accruals
  for each row execute function ledger.guard_accrual_changes();

create trigger checkpoint_accruals_no_truncate
  before truncate on ledger.checkpoint_accruals
  for each statement execute function ledger.forbid_truncate();

-- Earnings: runs inside the same transaction as the admin's verification.
create function ledger.accrue_on_verification()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  s record;
  f ledger.campaign_funding;
  v_prior bigint;
  v_raw bigint;
  v_gross bigint;
  v_fee bigint;
  v_net bigint;
  v_release timestamptz;
  v_escrow uuid;
  v_pending uuid;
  v_fees uuid;
  v_lines jsonb;
  v_txn uuid;
begin
  select sub.id, sub.campaign_id, sub.creator_id, sub.application_id, sub.status::text as status
  into s
  from public.submissions sub
  where sub.id = new.submission_id;

  if not found then
    return null;
  end if;

  -- Campaigns published before the ledger existed are not tracked here.
  select * into f from ledger.campaign_funding cf where cf.campaign_id = s.campaign_id;
  if not found then
    return null;
  end if;

  -- One creator's videos are accrued one at a time, so they share a single cap.
  perform 1 from public.applications a where a.id = s.application_id for update;

  select coalesce(sum(x.gross), 0)
  into v_prior
  from ledger.checkpoint_accruals x
  where x.campaign_id = s.campaign_id
    and x.creator_id = s.creator_id
    and x.status in ('held', 'flagged', 'released');

  v_raw := (coalesce(new.views, 0) * f.rate_per_1k) / 1000;
  v_gross := least(v_raw, greatest(0, f.creator_cap - v_prior));
  if s.status = 'rejected' then
    v_gross := 0;
  end if;

  v_fee := (v_gross * f.fee_bps + 5000) / 10000;
  v_net := v_gross - v_fee;
  v_release := coalesce(new.verified_at, now()) + make_interval(hours => f.hold_hours);

  if v_gross = 0 then
    insert into ledger.checkpoint_accruals (
      checkpoint_id, submission_id, campaign_id, creator_id, views, rate_per_1k,
      creator_cap, gross, fee, net, fee_bps, status, release_at
    )
    values (
      new.id, s.id, s.campaign_id, s.creator_id, coalesce(new.views, 0), f.rate_per_1k,
      f.creator_cap, 0, 0, 0, f.fee_bps, 'void', v_release
    )
    on conflict (checkpoint_id) do nothing;
    return null;
  end if;

  v_escrow := public.ledger_ensure_account('campaign_escrow', null, s.campaign_id);
  v_pending := public.ledger_ensure_account('creator_pending', null, null, s.creator_id);
  v_fees := public.ledger_ensure_account('platform_fees');

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_escrow, 'side', 'debit', 'amount', v_gross)
  );
  if v_net > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_pending, 'side', 'credit', 'amount', v_net)
    );
  end if;
  if v_fee > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_fees, 'side', 'credit', 'amount', v_fee)
    );
  end if;

  v_txn := public.ledger_post('checkpoint_accrual', 'accrue:' || new.id::text, v_lines, null);

  insert into ledger.checkpoint_accruals (
    checkpoint_id, submission_id, campaign_id, creator_id, views, rate_per_1k,
    creator_cap, gross, fee, net, fee_bps, status, release_at, accrual_transaction_id
  )
  values (
    new.id, s.id, s.campaign_id, s.creator_id, coalesce(new.views, 0), f.rate_per_1k,
    f.creator_cap, v_gross, v_fee, v_net, f.fee_bps, 'held', v_release, v_txn
  )
  on conflict (checkpoint_id) do nothing;

  return null;
end;
$function$;

create trigger view_checkpoints_accrue
  after update of status on public.view_checkpoints
  for each row
  when (new.status::text = 'verified' and old.status::text is distinct from 'verified')
  execute function ledger.accrue_on_verification();

-- Moves a held or flagged payout from pending to payable.
create function ledger.release_row(
  p_id uuid,
  p_resolved_by uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  a ledger.checkpoint_accruals;
  v_pending uuid;
  v_payable uuid;
  v_txn uuid;
begin
  select * into a from ledger.checkpoint_accruals x where x.id = p_id for update;

  if not found then
    raise exception 'unknown payout'
      using errcode = 'P0002';
  end if;

  if a.status = 'released' then
    return a.release_transaction_id;
  end if;

  if a.status not in ('held', 'flagged') then
    raise exception 'a payout in status % cannot be released', a.status
      using errcode = 'check_violation';
  end if;

  v_pending := public.ledger_ensure_account('creator_pending', null, null, a.creator_id);
  v_payable := public.ledger_ensure_account('creator_payable', null, null, a.creator_id);

  v_txn := public.ledger_post(
    'payout_release',
    'release:' || a.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_pending, 'side', 'debit', 'amount', a.net),
      jsonb_build_object('account_id', v_payable, 'side', 'credit', 'amount', a.net)
    ),
    null
  );

  update ledger.checkpoint_accruals x
  set status = 'released',
      release_transaction_id = v_txn,
      resolved_by = p_resolved_by,
      resolved_at = case when p_resolved_by is null then null else now() end,
      resolution_note = p_note
  where x.id = a.id;

  return v_txn;
end;
$function$;

-- A brand owner or manager launches a campaign: the budget moves from the wallet to escrow.
create or replace function public.publish_campaign(p_campaign_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  c record;
  v_fee_bps integer;
  v_hold_hours integer;
  v_cap bigint;
  v_wallet uuid;
  v_escrow uuid;
  v_balance bigint;
  v_txn uuid;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_campaign_id is null or public.can_manage_campaign(p_campaign_id) is not true then
    raise exception 'not allowed to publish this campaign'
      using errcode = 'insufficient_privilege';
  end if;

  select cam.id, cam.brand_id, cam.status::text as status, cam.budget, cam.creator_cap,
         cam.creators_needed, cam.rate_per_1k
  into c
  from public.campaigns cam
  where cam.id = p_campaign_id
  for update;

  if c.status <> 'draft' then
    raise exception 'only a draft campaign can be published'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from ledger.campaign_funding cf where cf.campaign_id = p_campaign_id) then
    raise exception 'this campaign is already funded'
      using errcode = 'check_violation';
  end if;

  select ps.fee_bps, ps.review_hours
  into v_fee_bps, v_hold_hours
  from public.platform_settings ps
  where ps.id = true;

  if v_fee_bps is null or v_hold_hours is null then
    raise exception 'platform fee and review settings are missing'
      using errcode = 'check_violation';
  end if;

  v_cap := coalesce(c.creator_cap, c.budget / greatest(c.creators_needed, 1));

  v_wallet := public.ledger_ensure_account('brand_wallet', c.brand_id);
  v_escrow := public.ledger_ensure_account('campaign_escrow', null, c.id);

  v_balance := public.ledger_balance(v_wallet);
  if v_balance < c.budget then
    raise exception 'insufficient wallet balance: need % TZS, have % TZS', c.budget, v_balance
      using errcode = 'check_violation';
  end if;

  v_txn := public.ledger_post(
    'campaign_funding',
    'fund:' || c.id::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_wallet, 'side', 'debit', 'amount', c.budget),
      jsonb_build_object('account_id', v_escrow, 'side', 'credit', 'amount', c.budget)
    ),
    null
  );

  insert into ledger.campaign_funding (
    campaign_id, brand_id, budget, creator_cap, rate_per_1k, fee_bps, hold_hours, ledger_transaction_id
  )
  values (c.id, c.brand_id, c.budget, v_cap, c.rate_per_1k, v_fee_bps, v_hold_hours, v_txn);

  update public.campaigns
  set status = 'live', published_at = now()
  where id = c.id;

  return v_txn;
end;
$function$;

-- Run on a schedule: releases every payout whose review hold has ended.
create or replace function public.release_due_accruals(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select x.id
    from ledger.checkpoint_accruals x
    where x.status = 'held' and x.release_at <= now()
    order by x.release_at
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update skip locked
  loop
    perform ledger.release_row(r.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- A brand owner or manager flags a payout during its review hold.
create or replace function public.flag_accrual(p_accrual_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_campaign uuid;
  a ledger.checkpoint_accruals;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  select x.campaign_id into v_campaign from ledger.checkpoint_accruals x where x.id = p_accrual_id;

  if v_campaign is null or public.can_manage_campaign(v_campaign) is not true then
    raise exception 'not allowed to flag this payout'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required'
      using errcode = 'check_violation';
  end if;

  select * into a from ledger.checkpoint_accruals x where x.id = p_accrual_id for update;

  if a.status = 'flagged' then
    return 'flagged';
  end if;

  if a.status <> 'held' then
    raise exception 'this payout is no longer open to flags'
      using errcode = 'check_violation';
  end if;

  if now() >= a.release_at then
    raise exception 'the review period for this payout has ended'
      using errcode = 'check_violation';
  end if;

  update ledger.checkpoint_accruals x
  set status = 'flagged',
      flagged_by = v_user,
      flagged_at = now(),
      flag_reason = btrim(p_reason)
  where x.id = a.id;

  return 'flagged';
end;
$function$;

-- An admin decides a flagged payout: release it to the creator or reverse it to escrow.
create or replace function public.resolve_accrual_flag(
  p_accrual_id uuid,
  p_decision text,
  p_note text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  a ledger.checkpoint_accruals;
  v_escrow uuid;
  v_pending uuid;
  v_fees uuid;
  v_lines jsonb;
  v_txn uuid;
begin
  if v_user is null or public.is_admin() is not true then
    raise exception 'only an admin can resolve a flagged payout'
      using errcode = 'insufficient_privilege';
  end if;

  if p_decision is null or p_decision not in ('release', 'reverse') then
    raise exception 'the decision must be release or reverse'
      using errcode = 'check_violation';
  end if;

  if p_note is null or char_length(btrim(p_note)) < 10 then
    raise exception 'a resolution note of at least 10 characters is required'
      using errcode = 'check_violation';
  end if;

  select * into a from ledger.checkpoint_accruals x where x.id = p_accrual_id for update;

  if not found then
    raise exception 'unknown payout'
      using errcode = 'P0002';
  end if;

  if a.status in ('released', 'reversed') then
    return a.status;
  end if;

  if a.status <> 'flagged' then
    raise exception 'only a flagged payout can be resolved'
      using errcode = 'check_violation';
  end if;

  if p_decision = 'release' then
    perform ledger.release_row(a.id, v_user, btrim(p_note));
    return 'released';
  end if;

  v_escrow := public.ledger_ensure_account('campaign_escrow', null, a.campaign_id);
  v_pending := public.ledger_ensure_account('creator_pending', null, null, a.creator_id);
  v_fees := public.ledger_ensure_account('platform_fees');

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_escrow, 'side', 'credit', 'amount', a.gross)
  );
  if a.net > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_pending, 'side', 'debit', 'amount', a.net)
    );
  end if;
  if a.fee > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_fees, 'side', 'debit', 'amount', a.fee)
    );
  end if;

  v_txn := public.ledger_post('payout_reversal', 'reverse:' || a.id::text, v_lines, null);

  update ledger.checkpoint_accruals x
  set status = 'reversed',
      reversal_transaction_id = v_txn,
      resolved_by = v_user,
      resolved_at = now(),
      resolution_note = btrim(p_note)
  where x.id = a.id;

  return 'reversed';
end;
$function$;

-- A creator sees their own earnings.
create or replace function public.list_my_earnings()
returns table (
  accrual_id uuid,
  campaign_id uuid,
  submission_id uuid,
  views bigint,
  gross bigint,
  fee bigint,
  net bigint,
  status text,
  release_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select x.id, x.campaign_id, x.submission_id, x.views, x.gross, x.fee, x.net, x.status, x.release_at
  from ledger.checkpoint_accruals x
  where x.creator_id = auth.uid()
  order by x.created_at desc
  limit 200;
$function$;

-- Brand owners and managers (and admins) see the payouts of their campaign.
create or replace function public.list_campaign_accruals(p_campaign_id uuid)
returns table (
  accrual_id uuid,
  creator_id uuid,
  views bigint,
  gross bigint,
  fee bigint,
  net bigint,
  status text,
  release_at timestamptz,
  flag_reason text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null
    or not (public.can_manage_campaign(p_campaign_id) is true or public.is_admin() is true)
  then
    raise exception 'not allowed to view this campaign''s payouts'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select x.id, x.creator_id, x.views, x.gross, x.fee, x.net, x.status, x.release_at, x.flag_reason
  from ledger.checkpoint_accruals x
  where x.campaign_id = p_campaign_id
  order by x.created_at desc
  limit 500;
end;
$function$;

revoke all on all functions in schema ledger from public, anon, authenticated, service_role;

revoke all on function public.publish_campaign(uuid) from public, anon;
revoke all on function public.release_due_accruals(integer) from public, anon, authenticated;
revoke all on function public.flag_accrual(uuid, text) from public, anon;
revoke all on function public.resolve_accrual_flag(uuid, text, text) from public, anon;
revoke all on function public.list_my_earnings() from public, anon;
revoke all on function public.list_campaign_accruals(uuid) from public, anon;

grant execute on function public.publish_campaign(uuid) to authenticated;
grant execute on function public.release_due_accruals(integer) to service_role;
grant execute on function public.flag_accrual(uuid, text) to authenticated;
grant execute on function public.resolve_accrual_flag(uuid, text, text) to authenticated;
grant execute on function public.list_my_earnings() to authenticated;
grant execute on function public.list_campaign_accruals(uuid) to authenticated;