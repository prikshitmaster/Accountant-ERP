-- =============================================================
-- Phase 3/4 — Stock ledger & reconciliation, P&L, Balance Sheet,
-- and period locking.
-- =============================================================

-- Per-item movement ledger with running balances (already stored on movements).
create or replace view v_stock_ledger with (security_invoker = on) as
select
  sm.org_id, sm.stock_item_id, si.name as item_name, si.unit,
  sm.date, v.voucher_no, vt.code as type_code,
  sm.qty_change, sm.unit_cost, sm.value_change, sm.balance_qty, sm.balance_value, sm.reason
from stock_movements sm
join stock_items si on si.id = sm.stock_item_id
left join vouchers v       on v.id = sm.voucher_id
left join voucher_types vt on vt.id = v.voucher_type;

-- Inventory ledger balance must equal Σ stock value (the core stock<->GL invariant).
create or replace view v_inventory_reconciliation with (security_invoker = on) as
select
  o.id as org_id,
  coalesce((select sum(le.debit - le.credit) from ledger_entries le
            join accounts a on a.id = le.account_id
            where le.org_id = o.id and a.system_key = 'inventory'), 0) as ledger_balance,
  coalesce((select sum(value_on_hand) from stock_items si where si.org_id = o.id), 0) as stock_value
from organizations o;

-- Profit & Loss: income (group 4) minus expense (group 5), per account.
create or replace view v_profit_loss with (security_invoker = on) as
select
  le.org_id, a.id as account_id, a.name as account_name, a.group_id,
  case when a.group_id = 4 then sum(le.credit - le.debit)
       else sum(le.debit - le.credit) end as amount
from ledger_entries le
join accounts a on a.id = le.account_id
where a.group_id in (4, 5)
group by le.org_id, a.id, a.name, a.group_id
having sum(le.debit) <> 0 or sum(le.credit) <> 0;

-- Balance Sheet: assets (1), liabilities (2), equity (3) with natural-sign balance.
-- Current-year profit is added to equity in the UI (income − expense from P&L).
create or replace view v_balance_sheet with (security_invoker = on) as
select
  le.org_id, a.id as account_id, a.name as account_name, a.group_id,
  case when a.group_id = 1 then sum(le.debit - le.credit)
       else sum(le.credit - le.debit) end as balance
from ledger_entries le
join accounts a on a.id = le.account_id
where a.group_id in (1, 2, 3)
group by le.org_id, a.id, a.name, a.group_id
having sum(le.debit) <> 0 or sum(le.credit) <> 0;

-- Lock all posting on/before a date (owner/accountant only).
create or replace function close_period(p_org uuid, p_lock_upto date)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org);
begin
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner','accountant') then raise exception 'forbidden_role'; end if;
  insert into period_locks (org_id, lock_upto) values (p_org, p_lock_upto)
    on conflict (org_id) do update set lock_upto = excluded.lock_upto;
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'LOCK_PERIOD', 'organization', p_org, jsonb_build_object('lock_upto', p_lock_upto));
end; $$;

grant select on v_stock_ledger, v_inventory_reconciliation, v_profit_loss, v_balance_sheet to authenticated;
grant execute on function close_period(uuid, date) to authenticated;
