-- The balance check fires at commit, outside ledger_post, so it would run as the caller.
-- Run it as its owner, so callers never need any access to the ledger schema.

create or replace function ledger.check_transaction_balanced()
returns trigger
language plpgsql
security definer
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