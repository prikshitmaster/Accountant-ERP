-- =============================================================
-- Monthly P&L view: income and expense aggregated per month.
-- Used by the dashboard Income & Expense chart.
-- =============================================================

create or replace view v_monthly_pl with (security_invoker = on) as
select
  le.org_id,
  date_trunc('month', le.date)::date                                       as month,
  coalesce(sum(le.credit) filter (where a.group_id = 4), 0)::bigint        as income,
  coalesce(sum(le.debit)  filter (where a.group_id = 5), 0)::bigint        as expense
from ledger_entries le
join accounts a on a.id = le.account_id and a.org_id = le.org_id
group by le.org_id, date_trunc('month', le.date)
order by month;

grant select on v_monthly_pl to authenticated;
