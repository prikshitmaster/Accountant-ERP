-- ============================================================
-- 0022_inventory_recon_fix.sql
-- Fix two inventory reconciliation (GL ≠ stock.value_on_hand) bugs:
--
-- Bug A — "exact zero-out" rounding residual:
--   When a sale exhausts ALL remaining stock (qty → 0), post_voucher
--   zeroes value_on_hand but sell() pre-computed COGS as
--   round(qty × avg_cost), which may leave a tiny residual in the GL.
--   Fix: sell() uses value_on_hand as COGS for exact zero-out.
--   post_voucher uses value_on_hand as value_change for exact zero-out.
--
-- Bug B — purchase_return uses p_rate for GL but avg_cost for stock:
--   purchase_return() credits the GL inventory account at the caller's
--   rate (p_rate), but post_voucher reduces value_on_hand at WAC
--   (avg_cost). When p_rate ≠ avg_cost the view v_inventory_reconciliation
--   diverges proportionally to (p_rate − avg_cost) × qty.
--   Fix: purchase_return() passes unit_cost=v_rate in the stock JSON.
--   post_voucher honours an explicit unit_cost on outward movements.
-- ============================================================

-- ── 1. post_voucher — fix outward path ───────────────────────────────────────
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
        v_new_avg   := v_item.avg_cost;
      end if;
    elsif v_qty >= 0 then
      -- inward at given unit cost
      v_unit_cost    := coalesce((st->>'unit_cost')::bigint, 0);
      v_value_change := round(v_qty * v_unit_cost);
      v_new_qty      := v_item.qty_on_hand + v_qty;
      v_new_value    := v_item.value_on_hand + v_value_change;
      v_new_avg      := case when v_new_qty <> 0 then round(v_new_value / v_new_qty) else 0 end;
    else
      -- outward: use provided unit_cost if set (e.g. purchase_return at original rate),
      --          else fall back to avg_cost (WAC) for sells / sales_returns
      if (st->>'unit_cost') is not null then
        v_unit_cost := (st->>'unit_cost')::bigint;
      else
        v_unit_cost := v_item.avg_cost;
      end if;
      v_new_qty := v_item.qty_on_hand + v_qty;
      if v_new_qty < 0 and v_policy = 'block' then
        raise exception 'negative_stock_blocked';
      end if;
      -- Bug A fix: exact zero-out → consume full remaining value to match the GL COGS entry
      if v_item.qty_on_hand + v_qty = 0 then
        v_value_change := -(v_item.value_on_hand);
      else
        v_value_change := round(v_qty * v_unit_cost);   -- negative
      end if;
      v_new_value := v_item.value_on_hand + v_value_change;
      v_new_avg   := v_item.avg_cost;                   -- unchanged on outward
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

-- ── 2. sell() — Bug A fix: exact zero-out uses value_on_hand as COGS ─────────
create or replace function sell(
  p_org      uuid,
  p_date     date,
  p_party    uuid,
  p_items    jsonb,
  p_mode     text    default 'credit',
  p_narration text   default null,
  p_discount bigint  default 0,
  p_freight  bigint  default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb; v_item stock_items%rowtype;
  v_qty numeric(18,4); v_rate bigint; v_line_base bigint; v_gst bigint;
  v_base bigint := 0; v_cogs bigint := 0;
  v_cgst bigint := 0; v_sgst bigint := 0; v_igst bigint := 0;
  v_taxable bigint; v_gross bigint; v_round_off bigint; v_bill bigint;
  v_lines jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_debit_acct uuid; v_party_line uuid; v_party_ledger uuid;
  v_org_state text; v_party_state text; v_inter boolean;
  v_res jsonb; v_invoice_id uuid;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  select state_code into v_org_state from org_settings where org_id = p_org;
  if p_party is not null then
    select state_code into v_party_state from parties where id = p_party and org_id = p_org;
  end if;
  v_inter := (v_party_state is not null and v_org_state is not null and v_party_state <> v_org_state);

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty  := (it->>'qty')::numeric;
    v_rate := (it->>'rate')::bigint;

    if v_qty <= 0      then raise exception 'invalid_quantity'; end if;
    if v_qty > 100000  then raise exception 'invalid_quantity'; end if;
    if v_rate <= 0     then raise exception 'invalid_amount'; end if;
    if v_rate > 99999900 then raise exception 'invalid_amount'; end if;

    select * into v_item from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base      := v_base + v_line_base;
    -- Bug A fix: if selling all remaining stock, use actual value_on_hand as COGS
    -- so it matches what post_voucher will use (avoids GL/stock residual divergence)
    if v_item.qty_on_hand = v_qty then
      v_cogs := v_cogs + v_item.value_on_hand;
    else
      v_cogs := v_cogs + round(v_qty * v_item.avg_cost);
    end if;
    if v_item.gst_rate > 0 then
      if v_inter then
        v_igst := v_igst + round(v_line_base * v_item.gst_rate / 100);
      else
        v_gst  := round(v_line_base * (v_item.gst_rate / 2) / 100);
        v_cgst := v_cgst + v_gst; v_sgst := v_sgst + v_gst;
      end if;
    end if;
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', -v_qty, 'reason', 'Sale'));
  end loop;

  if p_discount < 0 then raise exception 'invalid_amount'; end if;
  if p_discount >= v_base then raise exception 'invalid_amount'; end if;

  if p_discount > 0 and v_base > 0 then
    v_cgst := round(v_cgst::numeric * (v_base - p_discount) / v_base);
    v_sgst := round(v_sgst::numeric * (v_base - p_discount) / v_base);
    v_igst := round(v_igst::numeric * (v_base - p_discount) / v_base);
  end if;

  v_taxable   := v_base - p_discount;
  v_gross     := v_taxable + v_cgst + v_sgst + v_igst + p_freight;
  v_bill      := round(v_gross::numeric / 100) * 100;
  v_round_off := v_bill - v_gross;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_debit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_debit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_debit_acct, 'party_id', v_party_line, 'debit', v_bill, 'credit', 0),
    jsonb_build_object('account_id', sys_account(p_org,'sales'), 'debit', 0, 'credit', v_taxable + p_freight));
  if v_cgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_cgst'), 'debit', 0, 'credit', v_cgst)); end if;
  if v_sgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_sgst'), 'debit', 0, 'credit', v_sgst)); end if;
  if v_igst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_igst'), 'debit', 0, 'credit', v_igst)); end if;
  if v_round_off <> 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', sys_account(p_org,'roundoff'),
      'debit',  greatest(0, -v_round_off),
      'credit', greatest(0,  v_round_off)));
  end if;
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'cogs'),      'debit', v_cogs, 'credit', 0),
      jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', 0,      'credit', v_cogs));
  end if;

  v_res := post_voucher(p_org, 1::smallint, p_date, p_party, p_narration, v_lines, v_stock);

  if p_mode = 'credit' then
    insert into invoices (org_id, party_id, voucher_id, invoice_no, date,
                          total, outstanding, discount_amount, freight_amount, round_off)
      values (p_org, p_party, (v_res->>'voucher_id')::uuid, v_res->>'voucher_no', p_date,
              v_bill, v_bill, p_discount, p_freight, v_round_off)
      returning id into v_invoice_id;
    for it in select * from jsonb_array_elements(p_items) loop
      insert into invoice_lines (org_id, invoice_id, stock_item_id, qty, rate, amount)
      values (p_org, v_invoice_id,
        (it->>'stock_item_id')::uuid,
        (it->>'qty')::numeric,
        (it->>'rate')::bigint,
        round((it->>'qty')::numeric * (it->>'rate')::bigint)::bigint);
    end loop;
  end if;
  return v_res;
end; $$;
grant execute on function sell(uuid, date, uuid, jsonb, text, text, bigint, bigint) to authenticated;

-- ── 3. purchase_return() — Bug B fix: pass unit_cost=v_rate in stock JSON ────
create or replace function purchase_return(
  p_org       uuid,
  p_date      date,
  p_party     uuid,
  p_items     jsonb,
  p_mode      text   default 'credit',
  p_narration text   default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role      text := org_role(p_org);
  it          jsonb;
  v_item      stock_items%rowtype;
  v_qty       numeric(18,4);
  v_rate      bigint;
  v_line_base bigint;
  v_gst       bigint;
  v_base      bigint := 0;
  v_cgst      bigint := 0;
  v_sgst      bigint := 0;
  v_igst      bigint := 0;
  v_total     bigint;
  v_lines     jsonb  := '[]'::jsonb;
  v_stock     jsonb  := '[]'::jsonb;
  v_dr_acct   uuid;
  v_party_line uuid;
  v_party_ledger uuid;
  v_org_state text;
  v_party_state text;
  v_inter     boolean;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  select state_code into v_org_state   from org_settings where org_id = p_org;
  if p_party is not null then
    select state_code into v_party_state from parties where id = p_party and org_id = p_org;
  end if;
  v_inter := (v_party_state is not null and v_org_state is not null and v_party_state <> v_org_state);

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty  := (it->>'qty')::numeric;
    v_rate := (it->>'rate')::bigint;

    if v_qty <= 0      then raise exception 'invalid_quantity'; end if;
    if v_qty > 100000  then raise exception 'invalid_quantity'; end if;
    if v_rate <= 0     then raise exception 'invalid_amount'; end if;
    if v_rate > 99999900 then raise exception 'invalid_amount'; end if;

    select * into v_item from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base      := v_base + v_line_base;
    if v_item.gst_rate > 0 then
      if v_inter then
        v_igst := v_igst + round(v_line_base * v_item.gst_rate / 100);
      else
        v_gst  := round(v_line_base * (v_item.gst_rate / 2) / 100);
        v_cgst := v_cgst + v_gst;
        v_sgst := v_sgst + v_gst;
      end if;
    end if;
    -- Bug B fix: pass unit_cost=v_rate so post_voucher reduces value_on_hand at the
    -- same rate as the GL inventory credit (v_base), keeping reconciliation intact
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', -v_qty, 'unit_cost', v_rate, 'reason', 'Purchase Return'));
  end loop;
  v_total := v_base + v_cgst + v_sgst + v_igst;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_dr_acct    := v_party_ledger;
    v_party_line := p_party;
  else
    v_dr_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_dr_acct, 'party_id', v_party_line, 'debit', v_total, 'credit', 0));
  if v_cgst > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'input_cgst'), 'debit', 0, 'credit', v_cgst));
  end if;
  if v_sgst > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'input_sgst'), 'debit', 0, 'credit', v_sgst));
  end if;
  if v_igst > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'input_igst'), 'debit', 0, 'credit', v_igst));
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', 0, 'credit', v_base));

  return post_voucher(p_org, 8::smallint, p_date, p_party, p_narration, v_lines, v_stock);
end; $$;
grant execute on function purchase_return(uuid, date, uuid, jsonb, text, text) to authenticated;
