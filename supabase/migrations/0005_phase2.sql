-- =============================================================
-- Phase 2 — Parties documents: sell/purchase (with COGS),
-- receive_payment/make_payment (with allocations), ageing & ledger views.
-- =============================================================

-- ---------- SELL: Dr Debtor/Cash, Cr Sales; Dr COGS / Cr Inventory; outward stock; invoice ----------
-- p_items: [{stock_item_id, qty, rate}]  rate = selling price (paise/unit)
-- p_mode : 'credit' | 'cash' | 'bank'
create or replace function sell(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_mode text default 'credit', p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb;
  v_item stock_items%rowtype;
  v_qty numeric(18,4); v_rate bigint;
  v_total bigint := 0; v_cogs bigint := 0;
  v_lines jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_debit_acct uuid; v_party_line uuid; v_party_ledger uuid;
  v_res jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_rate := (it->>'rate')::bigint;
    select * into v_item from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_total := v_total + round(v_qty * v_rate);
    v_cogs  := v_cogs  + round(v_qty * v_item.avg_cost);
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', -v_qty, 'reason', 'Sale'));
  end loop;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_debit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_debit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_debit_acct, 'party_id', v_party_line, 'debit', v_total, 'credit', 0),
    jsonb_build_object('account_id', sys_account(p_org,'sales'), 'debit', 0, 'credit', v_total));
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'cogs'),      'debit', v_cogs, 'credit', 0),
      jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', 0,      'credit', v_cogs));
  end if;

  v_res := post_voucher(p_org, 1::smallint, p_date, p_party, p_narration, v_lines, v_stock);

  if p_mode = 'credit' then
    insert into invoices (org_id, party_id, voucher_id, invoice_no, date, total, outstanding)
      values (p_org, p_party, (v_res->>'voucher_id')::uuid, v_res->>'voucher_no', p_date, v_total, v_total);
  end if;
  return v_res;
end; $$;

-- ---------- PURCHASE: Dr Inventory, Cr Creditor/Cash; inward stock; bill ----------
-- p_items: [{stock_item_id, qty, rate}]  rate = cost (paise/unit)
create or replace function purchase(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_mode text default 'credit', p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb;
  v_qty numeric(18,4); v_rate bigint;
  v_total bigint := 0;
  v_lines jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_credit_acct uuid; v_party_line uuid; v_party_ledger uuid;
  v_res jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_rate := (it->>'rate')::bigint;
    if not exists(select 1 from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org) then
      raise exception 'unknown_stock_item';
    end if;
    v_total := v_total + round(v_qty * v_rate);
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', it->>'stock_item_id', 'qty_change', v_qty, 'unit_cost', v_rate, 'reason', 'Purchase'));
  end loop;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_credit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_credit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', v_total, 'credit', 0),
    jsonb_build_object('account_id', v_credit_acct, 'party_id', v_party_line, 'debit', 0, 'credit', v_total));

  v_res := post_voucher(p_org, 2::smallint, p_date, p_party, p_narration, v_lines, v_stock);

  if p_mode = 'credit' then
    insert into bills (org_id, party_id, voucher_id, bill_no, date, total, outstanding)
      values (p_org, p_party, (v_res->>'voucher_id')::uuid, v_res->>'voucher_no', p_date, v_total, v_total);
  end if;
  return v_res;
end; $$;

-- ---------- RECEIVE PAYMENT: Dr Cash/Bank, Cr Debtor; allocate to invoices ----------
-- p_allocations: [{invoice_id, amount}]
create or replace function receive_payment(
  p_org uuid, p_date date, p_party uuid, p_amount bigint,
  p_mode text default 'cash', p_allocations jsonb default '[]'::jsonb, p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_party_ledger uuid; v_res jsonb;
  al jsonb; v_amt bigint; v_out bigint; v_alloc_sum bigint := 0;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
  if v_party_ledger is null then raise exception 'unknown_party'; end if;

  v_res := post_voucher(p_org, 3::smallint, p_date, p_party, p_narration,
    jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org, case when p_mode='bank' then 'bank' else 'cash' end), 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_party_ledger, 'party_id', p_party, 'debit', 0, 'credit', p_amount)),
    '[]'::jsonb);

  for al in select * from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) loop
    v_amt := (al->>'amount')::bigint;
    select outstanding into v_out from invoices where id = (al->>'invoice_id')::uuid and org_id = p_org for update;
    if v_out is null then raise exception 'unknown_party'; end if;
    if v_amt > v_out then raise exception 'allocation_exceeds_outstanding'; end if;
    v_alloc_sum := v_alloc_sum + v_amt;
    insert into allocations (org_id, payment_voucher_id, target_kind, target_id, amount)
      values (p_org, (v_res->>'voucher_id')::uuid, 'invoice', (al->>'invoice_id')::uuid, v_amt);
    update invoices set outstanding = outstanding - v_amt where id = (al->>'invoice_id')::uuid;
  end loop;
  if v_alloc_sum > p_amount then raise exception 'allocation_exceeds_outstanding'; end if;
  return v_res;
end; $$;

-- ---------- MAKE PAYMENT: Dr Creditor, Cr Cash/Bank; allocate to bills ----------
create or replace function make_payment(
  p_org uuid, p_date date, p_party uuid, p_amount bigint,
  p_mode text default 'cash', p_allocations jsonb default '[]'::jsonb, p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_party_ledger uuid; v_res jsonb;
  al jsonb; v_amt bigint; v_out bigint; v_alloc_sum bigint := 0;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
  if v_party_ledger is null then raise exception 'unknown_party'; end if;

  v_res := post_voucher(p_org, 4::smallint, p_date, p_party, p_narration,
    jsonb_build_array(
      jsonb_build_object('account_id', v_party_ledger, 'party_id', p_party, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', sys_account(p_org, case when p_mode='bank' then 'bank' else 'cash' end), 'debit', 0, 'credit', p_amount)),
    '[]'::jsonb);

  for al in select * from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) loop
    v_amt := (al->>'amount')::bigint;
    select outstanding into v_out from bills where id = (al->>'bill_id')::uuid and org_id = p_org for update;
    if v_out is null then raise exception 'unknown_party'; end if;
    if v_amt > v_out then raise exception 'allocation_exceeds_outstanding'; end if;
    v_alloc_sum := v_alloc_sum + v_amt;
    insert into allocations (org_id, payment_voucher_id, target_kind, target_id, amount)
      values (p_org, (v_res->>'voucher_id')::uuid, 'bill', (al->>'bill_id')::uuid, v_amt);
    update bills set outstanding = outstanding - v_amt where id = (al->>'bill_id')::uuid;
  end loop;
  if v_alloc_sum > p_amount then raise exception 'allocation_exceeds_outstanding'; end if;
  return v_res;
end; $$;

-- ---------- Improved cancel: also reverse allocations against their documents ----------
create or replace function cancel_voucher(p_org uuid, p_voucher uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_v vouchers%rowtype;
  v_lock date;
  v_lines jsonb := '[]'::jsonb;
  v_stock jsonb := '[]'::jsonb;
  le record; mv record; al record;
  v_res jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner','accountant') then raise exception 'forbidden_role'; end if;

  select * into v_v from vouchers where id = p_voucher and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_v.status <> 'posted' then raise exception 'already_cancelled'; end if;
  select lock_upto into v_lock from period_locks where org_id = p_org;
  if v_lock is not null and v_v.date <= v_lock then raise exception 'period_locked'; end if;

  for le in select * from ledger_entries where voucher_id = p_voucher loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', le.account_id, 'party_id', le.party_id, 'debit', le.credit, 'credit', le.debit));
  end loop;
  for mv in select * from stock_movements where voucher_id = p_voucher loop
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', mv.stock_item_id, 'qty_change', (-mv.qty_change), 'unit_cost', mv.unit_cost, 'reason', 'Reversal'));
  end loop;

  update vouchers set status = 'cancelled' where id = p_voucher;
  v_res := post_voucher(p_org, v_v.voucher_type, v_v.date, v_v.party_id,
                        'Reversal of ' || v_v.voucher_no, v_lines, v_stock);
  update vouchers set reverses_id = p_voucher where id = (v_res->>'voucher_id')::uuid;

  -- restore documents this voucher created (sale/purchase)
  update invoices set outstanding = total where voucher_id = p_voucher;
  update bills     set outstanding = total where voucher_id = p_voucher;
  -- give back amounts this voucher had allocated (receipt/payment), then drop allocations
  for al in select * from allocations where payment_voucher_id = p_voucher loop
    if al.target_kind = 'invoice' then
      update invoices set outstanding = outstanding + al.amount where id = al.target_id;
    else
      update bills set outstanding = outstanding + al.amount where id = al.target_id;
    end if;
  end loop;
  delete from allocations where payment_voucher_id = p_voucher;

  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CANCEL_VOUCHER', 'voucher', p_voucher,
            jsonb_build_object('reversal', v_res->>'voucher_no'));
  return v_res;
end; $$;

-- ---------- Views ----------
create or replace view v_party_ledger with (security_invoker = on) as
select
  le.org_id, le.party_id, p.name as party_name,
  v.id as voucher_id, v.date, v.voucher_no, vt.code as type_code, v.narration, v.status,
  le.debit, le.credit,
  sum(le.debit - le.credit) over (
    partition by le.org_id, le.party_id order by v.date, v.voucher_no, le.id
    rows between unbounded preceding and current row) as running_balance
from ledger_entries le
join vouchers v       on v.id = le.voucher_id
join voucher_types vt on vt.id = v.voucher_type
join parties p        on p.id = le.party_id
where le.party_id is not null;

create or replace view v_aged_receivables with (security_invoker = on) as
select
  i.org_id, i.party_id, p.name as party_name, i.id as invoice_id, i.invoice_no, i.date,
  i.outstanding, (current_date - i.date) as age_days,
  case when current_date - i.date <= 30 then i.outstanding else 0 end as b_0_30,
  case when current_date - i.date between 31 and 60 then i.outstanding else 0 end as b_31_60,
  case when current_date - i.date between 61 and 90 then i.outstanding else 0 end as b_61_90,
  case when current_date - i.date > 90 then i.outstanding else 0 end as b_90_plus
from invoices i join parties p on p.id = i.party_id
where i.outstanding > 0;

create or replace view v_aged_payables with (security_invoker = on) as
select
  b.org_id, b.party_id, p.name as party_name, b.id as bill_id, b.bill_no, b.date,
  b.outstanding, (current_date - b.date) as age_days,
  case when current_date - b.date <= 30 then b.outstanding else 0 end as b_0_30,
  case when current_date - b.date between 31 and 60 then b.outstanding else 0 end as b_31_60,
  case when current_date - b.date between 61 and 90 then b.outstanding else 0 end as b_61_90,
  case when current_date - b.date > 90 then b.outstanding else 0 end as b_90_plus
from bills b join parties p on p.id = b.party_id
where b.outstanding > 0;

-- Parties list with live balance (debtor positive = owes us; creditor positive = we owe)
create or replace view v_parties with (security_invoker = on) as
select
  p.org_id, p.id, p.name, p.kind, p.phone, p.ledger_account_id,
  coalesce((select sum(le.debit - le.credit) from ledger_entries le
            where le.org_id = p.org_id and le.account_id = p.ledger_account_id), 0) as balance
from parties p;

grant execute on function sell(uuid, date, uuid, jsonb, text, text)            to authenticated;
grant execute on function purchase(uuid, date, uuid, jsonb, text, text)        to authenticated;
grant execute on function receive_payment(uuid, date, uuid, bigint, text, jsonb, text) to authenticated;
grant execute on function make_payment(uuid, date, uuid, bigint, text, jsonb, text)    to authenticated;
grant select on v_party_ledger, v_aged_receivables, v_aged_payables, v_parties to authenticated;
