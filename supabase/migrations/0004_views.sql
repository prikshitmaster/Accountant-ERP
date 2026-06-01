-- =============================================================
-- Phase 1 — Report read models. security_invoker = on so the
-- querying user's RLS (org membership) applies automatically.
-- =============================================================

-- Trial balance (full ledger; snapshots added in Phase 4)
create view v_trial_balance with (security_invoker = on) as
select
  le.org_id,
  a.id            as account_id,
  a.name          as account_name,
  a.group_id,
  g.name          as group_name,
  sum(le.debit)   as total_debit,
  sum(le.credit)  as total_credit,
  greatest(sum(le.debit)  - sum(le.credit), 0) as closing_debit,
  greatest(sum(le.credit) - sum(le.debit), 0) as closing_credit
from ledger_entries le
join accounts a       on a.id = le.account_id
join account_groups g on g.id = a.group_id
group by le.org_id, a.id, a.name, a.group_id, g.name;

-- Day book: one row per voucher with its total (sum of debits)
create view v_day_book with (security_invoker = on) as
select
  v.org_id,
  v.id            as voucher_id,
  v.date,
  vt.code         as type_code,
  vt.name         as type_name,
  v.voucher_no,
  v.narration,
  v.status,
  p.name          as party_name,
  coalesce((select sum(le.debit) from ledger_entries le where le.voucher_id = v.id), 0) as amount
from vouchers v
join voucher_types vt on vt.id = v.voucher_type
left join parties p   on p.id = v.party_id;

-- Dashboard summary: one row per org
create view v_dashboard_summary with (security_invoker = on) as
select
  o.id as org_id,
  coalesce((select sum(le.debit - le.credit) from ledger_entries le
            where le.org_id = o.id and le.account_id = (select id from accounts a where a.org_id = o.id and a.system_key = 'cash')), 0) as cash_balance,
  coalesce((select sum(le.debit - le.credit) from ledger_entries le
            where le.org_id = o.id and le.account_id = (select id from accounts a where a.org_id = o.id and a.system_key = 'bank')), 0) as bank_balance,
  coalesce((select sum(le.debit - le.credit) from ledger_entries le
            join accounts a on a.id = le.account_id
            where le.org_id = o.id and a.parent_id = (select id from accounts c where c.org_id = o.id and c.system_key = 'debtors')), 0) as receivables,
  coalesce((select sum(le.credit - le.debit) from ledger_entries le
            join accounts a on a.id = le.account_id
            where le.org_id = o.id and a.parent_id = (select id from accounts c where c.org_id = o.id and c.system_key = 'creditors')), 0) as payables,
  coalesce((select sum(le.credit - le.debit) from ledger_entries le
            where le.org_id = o.id and le.date = current_date
              and le.account_id = (select id from accounts a where a.org_id = o.id and a.system_key = 'sales')), 0) as today_sales,
  coalesce((select count(*) from stock_items si
            where si.org_id = o.id and si.is_active and si.qty_on_hand <= si.min_level), 0) as low_stock_count
from organizations o;

grant select on v_trial_balance, v_day_book, v_dashboard_summary to authenticated;
