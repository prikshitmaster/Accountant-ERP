-- =============================================================
-- Monthly cash flow: net debits/credits to cash+bank accounts.
-- Incoming = debits to cash/bank (money received).
-- Outgoing = credits to cash/bank (money paid out).
-- =============================================================

create or replace view v_monthly_cashflow with (security_invoker = on) as
select
  le.org_id,
  date_trunc('month', le.date)::date                                              as month,
  coalesce(sum(le.debit)  filter (where a.system_key in ('cash','bank')), 0)::bigint as incoming,
  coalesce(sum(le.credit) filter (where a.system_key in ('cash','bank')), 0)::bigint as outgoing
from ledger_entries le
join accounts a on a.id = le.account_id and a.org_id = le.org_id
group by le.org_id, date_trunc('month', le.date)
order by month;

grant select on v_monthly_cashflow to authenticated;
