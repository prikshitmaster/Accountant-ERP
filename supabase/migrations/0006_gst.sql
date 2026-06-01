-- =============================================================
-- GST (India) — place-of-supply CGST/SGST vs IGST, Input (asset) &
-- Output (liability) ledgers, GST-aware sell/purchase. Trust-critical:
-- entries follow the standard Indian treatment (ITC not capitalised).
-- =============================================================

-- ---------- New fields ----------
alter table org_settings add column if not exists gstin       text;
alter table org_settings add column if not exists state_code  text;   -- 2-digit GST state code
alter table parties      add column if not exists gstin       text;
alter table parties      add column if not exists state_code  text;
alter table stock_items  add column if not exists hsn         text;
alter table stock_items  add column if not exists gst_rate    numeric(5,2) not null default 0;  -- 0/5/12/18/28

-- ---------- GST system ledgers added to org bootstrap ----------
create or replace function seed_system_accounts(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into accounts (org_id, name, group_id, system_key, is_control, is_inventory, is_system) values
    (p_org, 'Cash',                   1, 'cash',              false, false, true),
    (p_org, 'Bank',                   1, 'bank',              false, false, true),
    (p_org, 'Sundry Debtors',         1, 'debtors',           true,  false, true),
    (p_org, 'Sundry Creditors',       2, 'creditors',         true,  false, true),
    (p_org, 'Sales',                  4, 'sales',             false, false, true),
    (p_org, 'Inventory',              1, 'inventory',         false, true,  true),
    (p_org, 'Cost of Goods Sold',     5, 'cogs',              false, false, true),
    (p_org, 'Opening Balance Equity', 3, 'opening_equity',    false, false, true),
    (p_org, 'Retained Earnings',      3, 'retained_earnings', false, false, true),
    (p_org, 'Round-off',              4, 'roundoff',          false, false, true),
    (p_org, 'Capital Account',        3, 'capital',           false, false, true),
    (p_org, 'Drawings',               3, 'drawings',          false, false, true),
    -- GST: Input = asset (ITC), Output = liability
    (p_org, 'Input CGST',             1, 'input_cgst',        false, false, true),
    (p_org, 'Input SGST',             1, 'input_sgst',        false, false, true),
    (p_org, 'Input IGST',             1, 'input_igst',        false, false, true),
    (p_org, 'Output CGST',            2, 'output_cgst',       false, false, true),
    (p_org, 'Output SGST',            2, 'output_sgst',       false, false, true),
    (p_org, 'Output IGST',            2, 'output_igst',       false, false, true);

  insert into accounts (org_id, name, group_id) values
    (p_org, 'Rent',                   5),
    (p_org, 'Salaries & Wages',       5),
    (p_org, 'Electricity',            5),
    (p_org, 'Telephone & Internet',   5),
    (p_org, 'Transport & Freight',    5),
    (p_org, 'Office Expenses',        5),
    (p_org, 'Bank Charges',           5),
    (p_org, 'Miscellaneous Expenses', 5);
end; $$;

-- ---------- Masters accept GST identity ----------
drop function if exists create_party(uuid, text, text, text);
create or replace function create_party(
  p_org uuid, p_name text, p_kind text, p_phone text default null,
  p_gstin text default null, p_state_code text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org); v_parent uuid; v_group smallint; v_account uuid; v_party uuid;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if p_kind = 'supplier' then v_parent := sys_account(p_org,'creditors'); v_group := 2;
  else                        v_parent := sys_account(p_org,'debtors');   v_group := 1; end if;
  insert into accounts (org_id, name, group_id, parent_id)
    values (p_org, p_name, v_group, v_parent) returning id into v_account;
  insert into parties (org_id, name, kind, phone, ledger_account_id, gstin, state_code)
    values (p_org, p_name, p_kind, p_phone, v_account, p_gstin, p_state_code) returning id into v_party;
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CREATE_PARTY', 'party', v_party, jsonb_build_object('name', p_name, 'kind', p_kind));
  return v_party;
end; $$;

drop function if exists create_stock_item(uuid, text, smallint, text, numeric);
create or replace function create_stock_item(
  p_org uuid, p_name text, p_item_type smallint, p_unit text,
  p_min_level numeric default 0, p_hsn text default null, p_gst_rate numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_item uuid;
begin
  if v_role is null then raise exception 'not_member'; end if;
  insert into stock_items (org_id, name, item_type, unit, min_level, hsn, gst_rate)
    values (p_org, p_name, p_item_type, p_unit, coalesce(p_min_level,0), p_hsn, coalesce(p_gst_rate,0))
    returning id into v_item;
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CREATE_STOCK_ITEM', 'stock_item', v_item, jsonb_build_object('name', p_name));
  return v_item;
end; $$;

-- ---------- GST-aware SELL ----------
create or replace function sell(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_mode text default 'credit', p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb; v_item stock_items%rowtype;
  v_qty numeric(18,4); v_rate bigint; v_line_base bigint; v_gst bigint;
  v_base bigint := 0; v_cogs bigint := 0;
  v_cgst bigint := 0; v_sgst bigint := 0; v_igst bigint := 0; v_total bigint;
  v_lines jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_debit_acct uuid; v_party_line uuid; v_party_ledger uuid;
  v_org_state text; v_party_state text; v_inter boolean;
  v_res jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  select state_code into v_org_state from org_settings where org_id = p_org;
  if p_party is not null then select state_code into v_party_state from parties where id = p_party and org_id = p_org; end if;
  v_inter := (v_party_state is not null and v_org_state is not null and v_party_state <> v_org_state);

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_rate := (it->>'rate')::bigint;
    select * into v_item from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base := v_base + v_line_base;
    v_cogs := v_cogs + round(v_qty * v_item.avg_cost);
    if v_item.gst_rate > 0 then
      if v_inter then
        v_igst := v_igst + round(v_line_base * v_item.gst_rate / 100);
      else
        v_gst := round(v_line_base * (v_item.gst_rate / 2) / 100);
        v_cgst := v_cgst + v_gst; v_sgst := v_sgst + v_gst;
      end if;
    end if;
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', -v_qty, 'reason', 'Sale'));
  end loop;
  v_total := v_base + v_cgst + v_sgst + v_igst;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_debit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_debit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_debit_acct, 'party_id', v_party_line, 'debit', v_total, 'credit', 0),
    jsonb_build_object('account_id', sys_account(p_org,'sales'), 'debit', 0, 'credit', v_base));
  if v_cgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_cgst'), 'debit', 0, 'credit', v_cgst)); end if;
  if v_sgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_sgst'), 'debit', 0, 'credit', v_sgst)); end if;
  if v_igst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_igst'), 'debit', 0, 'credit', v_igst)); end if;
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

-- ---------- GST-aware PURCHASE (Input GST = asset, not in stock cost) ----------
create or replace function purchase(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_mode text default 'credit', p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb; v_rate bigint; v_qty numeric(18,4); v_line_base bigint; v_gst bigint; v_grate numeric(5,2);
  v_base bigint := 0; v_cgst bigint := 0; v_sgst bigint := 0; v_igst bigint := 0; v_total bigint;
  v_lines jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_credit_acct uuid; v_party_line uuid; v_party_ledger uuid;
  v_org_state text; v_party_state text; v_inter boolean;
  v_res jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  select state_code into v_org_state from org_settings where org_id = p_org;
  if p_party is not null then select state_code into v_party_state from parties where id = p_party and org_id = p_org; end if;
  v_inter := (v_party_state is not null and v_org_state is not null and v_party_state <> v_org_state);

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_rate := (it->>'rate')::bigint;
    select gst_rate into v_grate from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base := v_base + v_line_base;
    if v_grate > 0 then
      if v_inter then v_igst := v_igst + round(v_line_base * v_grate / 100);
      else v_gst := round(v_line_base * (v_grate / 2) / 100); v_cgst := v_cgst + v_gst; v_sgst := v_sgst + v_gst; end if;
    end if;
    -- stock valued at base cost (GST is recoverable ITC, not part of cost)
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', it->>'stock_item_id', 'qty_change', v_qty, 'unit_cost', v_rate, 'reason', 'Purchase'));
  end loop;
  v_total := v_base + v_cgst + v_sgst + v_igst;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_credit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_credit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', v_base, 'credit', 0));
  if v_cgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'input_cgst'), 'debit', v_cgst, 'credit', 0)); end if;
  if v_sgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'input_sgst'), 'debit', v_sgst, 'credit', 0)); end if;
  if v_igst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'input_igst'), 'debit', v_igst, 'credit', 0)); end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_id', v_credit_acct, 'party_id', v_party_line, 'debit', 0, 'credit', v_total));

  v_res := post_voucher(p_org, 2::smallint, p_date, p_party, p_narration, v_lines, v_stock);
  if p_mode = 'credit' then
    insert into bills (org_id, party_id, voucher_id, bill_no, date, total, outstanding)
      values (p_org, p_party, (v_res->>'voucher_id')::uuid, v_res->>'voucher_no', p_date, v_total, v_total);
  end if;
  return v_res;
end; $$;

-- ---------- GST summary (output liability vs input credit vs net payable) ----------
create or replace view v_gst_summary with (security_invoker = on) as
with bal as (
  select a.org_id, a.system_key, coalesce(sum(le.credit - le.debit), 0) as cr_bal,
         coalesce(sum(le.debit - le.credit), 0) as dr_bal
  from accounts a left join ledger_entries le on le.account_id = a.id and le.org_id = a.org_id
  where a.system_key in ('output_cgst','output_sgst','output_igst','input_cgst','input_sgst','input_igst')
  group by a.org_id, a.system_key
)
select
  org_id,
  coalesce(sum(cr_bal) filter (where system_key like 'output_%'), 0) as output_tax,
  coalesce(sum(dr_bal) filter (where system_key like 'input_%'),  0) as input_credit,
  coalesce(sum(cr_bal) filter (where system_key like 'output_%'), 0)
    - coalesce(sum(dr_bal) filter (where system_key like 'input_%'), 0) as net_payable
from bal group by org_id;

grant execute on function create_party(uuid, text, text, text, text, text)            to authenticated;
grant execute on function create_stock_item(uuid, text, smallint, text, numeric, text, numeric) to authenticated;
grant execute on function sell(uuid, date, uuid, jsonb, text, text)                    to authenticated;
grant execute on function purchase(uuid, date, uuid, jsonb, text, text)                to authenticated;
grant select on v_gst_summary to authenticated;
