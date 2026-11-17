-- Run by hand in the PRODUCTION SQL Editor only. Never on the test project: a scheduled
-- job could release or close a payout just before a hosted test checks it.
-- To stop a job: select cron.unschedule('ledger-release-due');

create extension if not exists pg_cron;

select cron.schedule('ledger-release-due', '*/10 * * * *', $$select public.release_due_accruals()$$);
select cron.schedule('ledger-close-due', '5 * * * *', $$select public.close_due_campaigns()$$);
select cron.schedule('ledger-expire-deposits', '20 * * * *', $$select public.expire_stale_deposits()$$);