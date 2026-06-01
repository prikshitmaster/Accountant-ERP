-- =============================================================
-- Phase: Manufacture (BOM RM->FG). STOCK_JOURNAL voucher (type 9).
-- Additive, backward-compatible changes:
--   * post_voucher: stock lines may carry an explicit "value_change"
--     override (honored on BOTH inward and outward legs). Existing
--     callers never pass it, so their behaviour is unchanged.
--   * cancel_voucher: reversal negates the recorded value_change, so
--     every reversal restores the exact original value.
--   * manufacture(): new wrapper.
-- =============================================================

-- ---------- post_voucher (re-created with value_change override) ----------
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

  for line in select * from jsonb_array_elements(p_lines) loop
    v_sum_dr := v_sum_dr + coalesce((line->>'debit')::bigint, 0);
    v_sum_cr := v_sum_cr + coalesce((line->>'credit')::bigint, 0);
  end loop;
  if v_sum_dr <> v_sum_cr then
    raise exception 'unbalanced_voucher (dr=% cr=%)', v_sum_dr, v_sum_cr;
  end if;
  if v_sum_dr = 0 then raise exception 'empty_voucher'; end if;

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

  for line in select * from jsonb_array_elements(p_lines) loop
    insert into ledger_entries (org_id, voucher_id, account_id, party_id, debit, credit, date)
      values (p_org, v_voucher_id,
              (line->>'account_id')::uuid,
              nullif(line->>'party_id', '')::uuid,
              coalesce((line->>'debit')::bigint, 0),
              coalesce((line->>'credit')::bigint, 0),
              p_date);
  end loop;

  -- stock movements (Moving Weighted Average; optional value_change override)
  select negative_stock_policy into v_policy from org_settings where org_id = p_org;
  for st in select * from jsonb_array_elements(coalesce(p_stock, '[]'::jsonb)) loop
    select * into v_item from stock_items
      where id = (st->>'stock_item_id')::uuid and org_id = p_org for update;
    if not found then raise exception 'unknown_stock_item'; end if;

    v_qty := (st->>'qty_change')::numeric;

    if st ? 'value_change' then
      -- explicit value override (used by manufacture / exact reversals)
      v_value_change := (st->>'value_change')::bigint;
      v_new_qty      := v_item.qty_on_hand + v_qty;
      if v_qty < 0 and v_new_qty < 0 and v_policy = 'block' then
        raise exception 'negative_stock_blocked';
      end if;
      v_new_value    := v_item.value_on_hand + v_value_change;
      if v_qty >= 0 then
        v_unit_cost := case when v_qty <> 0 then round(v_value_change / v_qty) else 0 end;
        v_new_avg   := case when v_new_qty <> 0 then round(v_new_value / v_new_qty) else 0 end;
      else
        v_unit_cost := v_item.avg_cost;
        v_new_avg   := v_item.avg_cost;            -- avg unchanged on outward
      end if;
    elsif v_qty >= 0 then
      -- inward at given unit cost
      v_unit_cost    := coalesce((st->>'unit_cost')::bigint, 0);
      v_value_change := round(v_qty * v_unit_cost);
      v_new_qty      := v_item.qty_on_hand + v_qty;
      v_new_value    := v_item.value_on_hand + v_value_change;
      v_new_avg      := case when v_new_qty <> 0 then round(v_new_value / v_new_qty) else 0 end;
    else
      -- outward at current average cost
      v_unit_cost    := v_item.avg_cost;
      v_value_change := round(v_qty * v_item.avg_cost);   -- negative
      v_new_qty      := v_item.qty_on_hand + v_qty;
      if v_new_qty < 0 and v_policy = 'block' then
        raise exception 'negative_stock_blocked';
      end if;
      v_new_value    := v_item.value_on_hand + v_value_change;
      v_new_avg      := v_item.avg_cost;                  -- unchanged on outward
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

-- ---------- cancel_voucher (re-created: exact value reversal) ----------
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

  for le in select * from ledger_entries where voucher_id = p_voucher loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', le.account_id, 'party_id', le.party_id,
      'debit', le.credit, 'credit', le.debit));
  end loop;

  -- negate each original movement, restoring the EXACT recorded value
  for mv in select * from stock_movements where voucher_id = p_voucher loop
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', mv.stock_item_id, 'qty_change', (-mv.qty_change),
      'value_change', (-mv.value_change), 'reason', 'Reversal'));
  end loop;

  v_v.status := 'cancelled';
  update vouchers set status = 'cancelled' where id = p_voucher;

  v_res := post_voucher(p_org, v_v.voucher_type, v_v.date, v_v.party_id,
                        'Reversal of ' || v_v.voucher_no, v_lines, v_stock);
  update vouchers set reverses_id = p_voucher where id = (v_res->>'voucher_id')::uuid;

  update invoices set outstanding = total where voucher_id = p_voucher;
  update bills     set outstanding = total where voucher_id = p_voucher;
  delete from allocations where payment_voucher_id = p_voucher;

  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CANCEL_VOUCHER', 'voucher', p_voucher,
            jsonb_build_object('reversal', v_res->>'voucher_no'));
  return v_res;
end; $$;

-- ---------- manufacture (BOM RM->FG) ----------
-- p_inputs : [{stock_item_id, qty}]            consumed at current avg cost
-- p_outputs: [{stock_item_id, qty, weight}]    produced; cost split by weight
create or replace function manufacture(
  p_org uuid, p_date date, p_inputs jsonb, p_outputs jsonb,
  p_narration text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb;
  v_item stock_items%rowtype;
  v_qty numeric(18,4);
  v_weight numeric;
  v_total_rm bigint := 0;
  v_total_weight numeric := 0;
  v_running bigint := 0;
  v_alloc bigint;
  v_n int;
  v_i int := 0;
  v_inv uuid := sys_account(p_org, 'inventory');
  v_lines jsonb;
  v_stock jsonb := '[]'::jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_inputs, '[]'::jsonb)) = 0
     or jsonb_array_length(coalesce(p_outputs, '[]'::jsonb)) = 0 then
    raise exception 'empty_voucher';
  end if;

  -- inputs: consume at current avg cost
  for it in select * from jsonb_array_elements(p_inputs) loop
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid_quantity'; end if;
    select * into v_item from stock_items
      where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_total_rm := v_total_rm + round(v_qty * v_item.avg_cost);
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', -v_qty, 'reason', 'Manufacture: consume'));
  end loop;

  if v_total_rm <= 0 then raise exception 'zero_cost_manufacture'; end if;

  -- total weight (validate)
  for it in select * from jsonb_array_elements(p_outputs) loop
    v_weight := (it->>'weight')::numeric;
    if v_weight is null or v_weight <= 0 then raise exception 'invalid_weight'; end if;
    v_total_weight := v_total_weight + v_weight;
  end loop;

  -- outputs: allocate total RM value by weight; last output absorbs remainder
  v_n := jsonb_array_length(p_outputs);
  for it in select * from jsonb_array_elements(p_outputs) loop
    v_i := v_i + 1;
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid_quantity'; end if;
    if not exists (select 1 from stock_items
                   where id = (it->>'stock_item_id')::uuid and org_id = p_org) then
      raise exception 'unknown_stock_item';
    end if;
    v_weight := (it->>'weight')::numeric;
    if v_i < v_n then
      v_alloc := round(v_total_rm * v_weight / v_total_weight);
      v_running := v_running + v_alloc;
    else
      v_alloc := v_total_rm - v_running;        -- exact conservation
    end if;
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', it->>'stock_item_id', 'qty_change', v_qty,
      'value_change', v_alloc, 'reason', 'Manufacture: produce'));
  end loop;

  -- ledger: Dr Inventory / Cr Inventory (same account, net-zero, balanced)
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_inv, 'debit', v_total_rm, 'credit', 0),
    jsonb_build_object('account_id', v_inv, 'debit', 0, 'credit', v_total_rm));

  return post_voucher(p_org, 9::smallint, p_date, null, p_narration, v_lines, v_stock);
end; $$;

grant execute on function manufacture(uuid, date, jsonb, jsonb, text) to authenticated;
