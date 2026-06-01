-- =============================================================
-- Phase 1 — Accounting engine (SECURITY DEFINER RPC functions).
-- The ONLY write path to the financial core. Atomic & audited.
-- =============================================================

-- ---------- Seed system accounts for a new org ----------
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
    (p_org, 'Drawings',               3, 'drawings',          false, false, true);

  -- Common expense heads (editable, not system) so Expense is usable immediately.
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

-- ---------- Create organization (also makes caller the owner) ----------
create or replace function create_organization(p_name text, p_fy_start_month smallint default 4)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  insert into organizations (name, fy_start_month) values (p_name, coalesce(p_fy_start_month,4))
    returning id into v_org;
  insert into memberships (org_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into org_settings (org_id, business_name) values (v_org, p_name);
  perform seed_system_accounts(v_org);
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (v_org, v_uid, 'CREATE_ORG', 'organization', v_org, jsonb_build_object('name', p_name));
  return v_org;
end; $$;

-- ---------- Master poster ----------
-- p_lines : [{account_id, party_id?, debit, credit}]  (complete balanced GL set)
-- p_stock : [{stock_item_id, qty_change, unit_cost?, reason?}]  (+ inward, - outward)
create or replace function post_voucher(
  p_org uuid, p_type smallint, p_date date, p_party uuid,
  p_narration text, p_lines jsonb, p_stock jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_lock date;
  v_fy_start smallint;
  v_fy int;
  v_code text;
  v_fy_label text;
  v_seq int;
  v_voucher_no text;
  v_voucher_id uuid;
  v_sum_dr bigint := 0;
  v_sum_cr bigint := 0;
  line jsonb;
  st jsonb;
  v_item stock_items%rowtype;
  v_qty numeric(18,4);
  v_unit_cost bigint;
  v_value_change bigint;
  v_new_qty numeric(18,4);
  v_new_value bigint;
  v_new_avg bigint;
  v_policy text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_role := org_role(p_org);
  if v_role is null then raise exception 'not_member'; end if;

  select lock_upto into v_lock from period_locks where org_id = p_org;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'period_locked';
  end if;

  -- balance check
  for line in select * from jsonb_array_elements(p_lines) loop
    v_sum_dr := v_sum_dr + coalesce((line->>'debit')::bigint, 0);
    v_sum_cr := v_sum_cr + coalesce((line->>'credit')::bigint, 0);
  end loop;
  if v_sum_dr <> v_sum_cr then
    raise exception 'unbalanced_voucher (dr=% cr=%)', v_sum_dr, v_sum_cr;
  end if;
  if v_sum_dr = 0 then raise exception 'empty_voucher'; end if;

  -- FY-aware gapless numbering
  select fy_start_month into v_fy_start from organizations where id = p_org;
  v_fy := case when extract(month from p_date) >= v_fy_start
               then extract(year from p_date)::int
               else extract(year from p_date)::int - 1 end;
  select code into v_code from voucher_types where id = p_type;
  v_fy_label := v_fy::text || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0');

  insert into voucher_sequences (org_id, voucher_type, fy_year, next_no)
    values (p_org, p_type, v_fy, 1)
    on conflict (org_id, voucher_type, fy_year) do nothing;
  update voucher_sequences set next_no = next_no + 1
    where org_id = p_org and voucher_type = p_type and fy_year = v_fy
    returning next_no - 1 into v_seq;

  v_voucher_no := v_code || '/' || v_fy_label || '/' || lpad(v_seq::text, 4, '0');

  insert into vouchers (org_id, voucher_type, voucher_no, date, narration, party_id, created_by)
    values (p_org, p_type, v_voucher_no, p_date, p_narration, p_party, v_uid)
    returning id into v_voucher_id;

  -- ledger lines
  for line in select * from jsonb_array_elements(p_lines) loop
    insert into ledger_entries (org_id, voucher_id, account_id, party_id, debit, credit, date)
      values (p_org, v_voucher_id,
              (line->>'account_id')::uuid,
              nullif(line->>'party_id', '')::uuid,
              coalesce((line->>'debit')::bigint, 0),
              coalesce((line->>'credit')::bigint, 0),
              p_date);
  end loop;

  -- stock movements (Moving Weighted Average)
  select negative_stock_policy into v_policy from org_settings where org_id = p_org;
  for st in select * from jsonb_array_elements(coalesce(p_stock, '[]'::jsonb)) loop
    select * into v_item from stock_items
      where id = (st->>'stock_item_id')::uuid and org_id = p_org for update;
    if not found then raise exception 'unknown_stock_item'; end if;

    v_qty := (st->>'qty_change')::numeric;
    if v_qty >= 0 then
      -- inward at given unit cost
      v_unit_cost   := coalesce((st->>'unit_cost')::bigint, 0);
      v_value_change := round(v_qty * v_unit_cost);
      v_new_qty     := v_item.qty_on_hand + v_qty;
      v_new_value   := v_item.value_on_hand + v_value_change;
      v_new_avg     := case when v_new_qty <> 0 then round(v_new_value / v_new_qty) else 0 end;
    else
      -- outward at current average cost
      v_unit_cost   := v_item.avg_cost;
      v_value_change := round(v_qty * v_item.avg_cost);   -- negative
      v_new_qty     := v_item.qty_on_hand + v_qty;
      if v_new_qty < 0 and v_policy = 'block' then
        raise exception 'negative_stock_blocked';
      end if;
      v_new_value   := v_item.value_on_hand + v_value_change;
      v_new_avg     := v_item.avg_cost;                   -- unchanged on outward
    end if;
    if v_new_qty = 0 then v_new_value := 0; end if;

    update stock_items
      set qty_on_hand = v_new_qty, value_on_hand = v_new_value, avg_cost = v_new_avg
      where id = v_item.id;

    insert into stock_movements
      (org_id, stock_item_id, voucher_id, date, qty_change, unit_cost,
       value_change, balance_qty, balance_value, reason)
    values
      (p_org, v_item.id, v_voucher_id, p_date, v_qty, v_unit_cost,
       v_value_change, v_new_qty, v_new_value, st->>'reason');
  end loop;

  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, v_uid, 'POST_VOUCHER', 'voucher', v_voucher_id,
            jsonb_build_object('voucher_no', v_voucher_no, 'type', p_type));

  return jsonb_build_object('voucher_id', v_voucher_id, 'voucher_no', v_voucher_no);
end; $$;

-- ---------- Masters ----------
create or replace function create_party(p_org uuid, p_name text, p_kind text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_parent uuid;
  v_group smallint;
  v_account uuid;
  v_party uuid;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if p_kind = 'supplier' then
    v_parent := sys_account(p_org, 'creditors'); v_group := 2;
  else
    v_parent := sys_account(p_org, 'debtors');   v_group := 1;
  end if;
  insert into accounts (org_id, name, group_id, parent_id)
    values (p_org, p_name, v_group, v_parent) returning id into v_account;
  insert into parties (org_id, name, kind, phone, ledger_account_id)
    values (p_org, p_name, p_kind, p_phone, v_account) returning id into v_party;
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CREATE_PARTY', 'party', v_party, jsonb_build_object('name', p_name, 'kind', p_kind));
  return v_party;
end; $$;

create or replace function create_stock_item(
  p_org uuid, p_name text, p_item_type smallint, p_unit text, p_min_level numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_item uuid;
begin
  if v_role is null then raise exception 'not_member'; end if;
  insert into stock_items (org_id, name, item_type, unit, min_level)
    values (p_org, p_name, p_item_type, p_unit, coalesce(p_min_level,0)) returning id into v_item;
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CREATE_STOCK_ITEM', 'stock_item', v_item, jsonb_build_object('name', p_name));
  return v_item;
end; $$;

-- ---------- Document wrappers (Phase 1 set) ----------
create or replace function expense(
  p_org uuid, p_date date, p_expense_account uuid, p_amount bigint,
  p_mode text default 'cash', p_party uuid default null, p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pay uuid; v_lines jsonb;
begin
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  v_pay := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', p_expense_account, 'debit', p_amount, 'credit', 0),
    jsonb_build_object('account_id', v_pay,             'debit', 0,        'credit', p_amount));
  return post_voucher(p_org, 4::smallint, p_date, p_party, p_narration, v_lines, '[]'::jsonb);
end; $$;

create or replace function contra(
  p_org uuid, p_date date, p_from_account uuid, p_to_account uuid, p_amount bigint, p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lines jsonb;
begin
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', p_to_account,   'debit', p_amount, 'credit', 0),
    jsonb_build_object('account_id', p_from_account, 'debit', 0,        'credit', p_amount));
  return post_voucher(p_org, 5::smallint, p_date, null, p_narration, v_lines, '[]'::jsonb);
end; $$;

create or replace function introduce_capital(p_org uuid, p_date date, p_amount bigint, p_mode text default 'cash')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_pay uuid; v_lines jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner','accountant') then raise exception 'forbidden_role'; end if;
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  v_pay := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_pay,                          'debit', p_amount, 'credit', 0),
    jsonb_build_object('account_id', sys_account(p_org,'capital'),   'debit', 0,        'credit', p_amount));
  return post_voucher(p_org, 6::smallint, p_date, null, 'Capital introduced', v_lines, '[]'::jsonb);
end; $$;

create or replace function drawings(p_org uuid, p_date date, p_amount bigint, p_mode text default 'cash')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_pay uuid; v_lines jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner','accountant') then raise exception 'forbidden_role'; end if;
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  v_pay := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', sys_account(p_org,'drawings'), 'debit', p_amount, 'credit', 0),
    jsonb_build_object('account_id', v_pay,                         'debit', 0,        'credit', p_amount));
  return post_voucher(p_org, 6::smallint, p_date, null, 'Drawings', v_lines, '[]'::jsonb);
end; $$;

-- ---------- Opening balances (against Opening Balance Equity) ----------
-- p_entries : [{account_id, party_id?, debit, credit}]  (asset/liab/party opening)
-- p_stock   : [{stock_item_id, qty, unit_cost}]
create or replace function opening_balances(p_org uuid, p_entries jsonb default '[]'::jsonb, p_stock jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_lines jsonb := '[]'::jsonb;
  v_stock_in jsonb := '[]'::jsonb;
  e jsonb; s jsonb;
  v_net bigint := 0;
  v_inv_total bigint := 0;
  v_qty numeric(18,4); v_cost bigint;
  v_eq uuid;
  v_fy_start smallint; v_year int; v_date date;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner','accountant') then raise exception 'forbidden_role'; end if;

  for e in select * from jsonb_array_elements(coalesce(p_entries,'[]'::jsonb)) loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', e->>'account_id', 'party_id', e->>'party_id',
      'debit', coalesce((e->>'debit')::bigint,0), 'credit', coalesce((e->>'credit')::bigint,0)));
    v_net := v_net + coalesce((e->>'debit')::bigint,0) - coalesce((e->>'credit')::bigint,0);
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p_stock,'[]'::jsonb)) loop
    v_qty := (s->>'qty')::numeric; v_cost := (s->>'unit_cost')::bigint;
    v_inv_total := v_inv_total + round(v_qty * v_cost);
    v_stock_in := v_stock_in || jsonb_build_array(jsonb_build_object(
      'stock_item_id', s->>'stock_item_id', 'qty_change', v_qty, 'unit_cost', v_cost, 'reason', 'Opening stock'));
  end loop;

  if v_inv_total <> 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', sys_account(p_org,'inventory'), 'debit', v_inv_total, 'credit', 0));
    v_net := v_net + v_inv_total;
  end if;

  -- balancing plug to Opening Balance Equity
  v_eq := sys_account(p_org,'opening_equity');
  if v_net > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_eq, 'debit', 0, 'credit', v_net));
  elsif v_net < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_eq, 'debit', -v_net, 'credit', 0));
  end if;

  if jsonb_array_length(v_lines) = 0 then raise exception 'opening_empty'; end if;

  select fy_start_month into v_fy_start from organizations where id = p_org;
  v_year := case when extract(month from current_date) >= v_fy_start
                 then extract(year from current_date)::int
                 else extract(year from current_date)::int - 1 end;
  v_date := make_date(v_year, v_fy_start, 1);

  return post_voucher(p_org, 10::smallint, v_date, null, 'Opening balances', v_lines, v_stock_in);
end; $$;

-- ---------- Cancellation (immutable reversal) ----------
create or replace function cancel_voucher(p_org uuid, p_voucher uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_v vouchers%rowtype;
  v_lock date;
  v_lines jsonb := '[]'::jsonb;
  v_stock jsonb := '[]'::jsonb;
  le record; mv record;
  v_res jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner','accountant') then raise exception 'forbidden_role'; end if;

  select * into v_v from vouchers where id = p_voucher and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_v.status <> 'posted' then raise exception 'already_cancelled'; end if;

  select lock_upto into v_lock from period_locks where org_id = p_org;
  if v_lock is not null and v_v.date <= v_lock then raise exception 'period_locked'; end if;

  -- swap dr/cr for each original ledger line
  for le in select * from ledger_entries where voucher_id = p_voucher loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', le.account_id, 'party_id', le.party_id,
      'debit', le.credit, 'credit', le.debit));
  end loop;

  -- negate each original stock movement (restores qty & value)
  for mv in select * from stock_movements where voucher_id = p_voucher loop
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', mv.stock_item_id, 'qty_change', (-mv.qty_change),
      'unit_cost', mv.unit_cost, 'reason', 'Reversal'));
  end loop;

  v_v.status := 'cancelled';
  update vouchers set status = 'cancelled' where id = p_voucher;

  v_res := post_voucher(p_org, v_v.voucher_type, v_v.date, v_v.party_id,
                        'Reversal of ' || v_v.voucher_no, v_lines, v_stock);
  update vouchers set reverses_id = p_voucher where id = (v_res->>'voucher_id')::uuid;

  -- restore documents (no-op in Phase 1; guarded for Phase 2)
  update invoices set outstanding = total where voucher_id = p_voucher;
  update bills     set outstanding = total where voucher_id = p_voucher;
  delete from allocations where payment_voucher_id = p_voucher;

  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CANCEL_VOUCHER', 'voucher', p_voucher,
            jsonb_build_object('reversal', v_res->>'voucher_no'));
  return v_res;
end; $$;

-- ---------- Grants ----------
grant execute on function create_organization(text, smallint)        to authenticated;
grant execute on function post_voucher(uuid, smallint, date, uuid, text, jsonb, jsonb) to authenticated;
grant execute on function create_party(uuid, text, text, text)        to authenticated;
grant execute on function create_stock_item(uuid, text, smallint, text, numeric) to authenticated;
grant execute on function expense(uuid, date, uuid, bigint, text, uuid, text) to authenticated;
grant execute on function contra(uuid, date, uuid, uuid, bigint, text) to authenticated;
grant execute on function introduce_capital(uuid, date, bigint, text)  to authenticated;
grant execute on function drawings(uuid, date, bigint, text)           to authenticated;
grant execute on function opening_balances(uuid, jsonb, jsonb)         to authenticated;
grant execute on function cancel_voucher(uuid, uuid)                   to authenticated;
