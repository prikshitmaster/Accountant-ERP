-- ============================================================
-- 0021_tighten_guards.sql
-- Fix three real bugs found by extreme adversarial tests:
--   1. Rate max was 9999999900 paise (≈₹10cr) — tighten to 99999900 (₹9,99,999)
--   2. Zero-rate sales crash ledger_entries check constraint → reject rate=0
--   3. 100%-discount sales create zero-value lines → reject discount >= subtotal
-- ============================================================

-- ── 1. Fix CHECK constraints on SO/PO line tables ────────────────────────────
alter table sales_order_lines    drop constraint if exists sol_rate_max;
alter table purchase_order_lines drop constraint if exists pol_rate_max;

alter table sales_order_lines    add constraint sol_rate_max check (rate > 0 and rate <= 99999900);
alter table purchase_order_lines add constraint pol_rate_max check (rate > 0 and rate <= 99999900);

-- ── 2. sell() — tighten rate guard, reject zero rate, reject 100% discount ───
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

    -- ── GUARDS ──
    if v_qty <= 0      then raise exception 'invalid_quantity'; end if;
    if v_qty > 100000  then raise exception 'invalid_quantity'; end if;
    if v_rate <= 0     then raise exception 'invalid_amount'; end if;  -- ← was < 0; now rejects zero
    if v_rate > 99999900 then raise exception 'invalid_amount'; end if; -- ← tightened from 9999999900

    select * into v_item from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base      := v_base + v_line_base;
    v_cogs      := v_cogs + round(v_qty * v_item.avg_cost);
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

  -- Discount must be non-negative and strictly less than subtotal (reject 100% discount)
  if p_discount < 0 then raise exception 'invalid_amount'; end if;
  if p_discount >= v_base then raise exception 'invalid_amount'; end if; -- ← was > ; now >= blocks 100%

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

-- ── 3. purchase() — tighten rate guard, reject zero rate ─────────────────────
create or replace function purchase(
  p_org      uuid,
  p_date     date,
  p_party    uuid,
  p_items    jsonb,
  p_mode     text   default 'credit',
  p_narration text  default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb; v_rate bigint; v_qty numeric(18,4); v_line_base bigint; v_gst bigint; v_grate numeric(5,2);
  v_base bigint := 0; v_cgst bigint := 0; v_sgst bigint := 0; v_igst bigint := 0; v_total bigint;
  v_lines jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_credit_acct uuid; v_party_line uuid; v_party_ledger uuid;
  v_org_state text; v_party_state text; v_inter boolean;
  v_res jsonb; v_bill_id uuid;
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

    -- ── GUARDS ──
    if v_qty <= 0      then raise exception 'invalid_quantity'; end if;
    if v_qty > 100000  then raise exception 'invalid_quantity'; end if;
    if v_rate <= 0     then raise exception 'invalid_amount'; end if;  -- ← rejects zero rate
    if v_rate > 99999900 then raise exception 'invalid_amount'; end if; -- ← tightened

    select gst_rate into v_grate from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base      := v_base + v_line_base;
    if v_grate > 0 then
      if v_inter then
        v_igst := v_igst + round(v_line_base * v_grate / 100);
      else
        v_gst  := round(v_line_base * (v_grate / 2) / 100);
        v_cgst := v_cgst + v_gst; v_sgst := v_sgst + v_gst;
      end if;
    end if;
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
      values (p_org, p_party, (v_res->>'voucher_id')::uuid, v_res->>'voucher_no', p_date, v_total, v_total)
      returning id into v_bill_id;
    for it in select * from jsonb_array_elements(p_items) loop
      insert into bill_lines (org_id, bill_id, stock_item_id, qty, rate, amount)
      values (p_org, v_bill_id,
        (it->>'stock_item_id')::uuid,
        (it->>'qty')::numeric,
        (it->>'rate')::bigint,
        round((it->>'qty')::numeric * (it->>'rate')::bigint)::bigint);
    end loop;
  end if;
  return v_res;
end; $$;
grant execute on function purchase(uuid, date, uuid, jsonb, text, text) to authenticated;

-- ── 4. sales_return() — tighten rate guard ────────────────────────────────────
create or replace function sales_return(
  p_org      uuid,
  p_date     date,
  p_party    uuid,
  p_items    jsonb,
  p_mode     text    default 'credit',
  p_narration text   default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb; v_item stock_items%rowtype;
  v_qty numeric(18,4); v_rate bigint; v_line_base bigint; v_gst bigint;
  v_base bigint := 0; v_cogs bigint := 0;
  v_cgst bigint := 0; v_sgst bigint := 0; v_igst bigint := 0; v_total bigint;
  v_lines jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_cr_acct uuid; v_party_line uuid; v_party_ledger uuid;
  v_org_state text; v_party_state text; v_inter boolean;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  select state_code into v_org_state   from org_settings where org_id = p_org;
  if p_party is not null then
    select state_code into v_party_state from parties where id = p_party and org_id = p_org;
  end if;
  v_inter := (v_party_state is not null and v_org_state is not null and v_party_state <> v_org_state);

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty  := (it->>'qty')::numeric;
    v_rate := (it->>'rate')::bigint;

    -- ── GUARDS ──
    if v_qty <= 0      then raise exception 'invalid_quantity'; end if;
    if v_qty > 100000  then raise exception 'invalid_quantity'; end if;
    if v_rate <= 0     then raise exception 'invalid_amount'; end if;
    if v_rate > 99999900 then raise exception 'invalid_amount'; end if; -- ← tightened

    select * into v_item from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base      := v_base + v_line_base;
    v_cogs      := v_cogs + round(v_qty * v_item.avg_cost);
    if v_item.gst_rate > 0 then
      if v_inter then
        v_igst := v_igst + round(v_line_base * v_item.gst_rate / 100);
      else
        v_gst  := round(v_line_base * (v_item.gst_rate / 2) / 100);
        v_cgst := v_cgst + v_gst; v_sgst := v_sgst + v_gst;
      end if;
    end if;
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', v_qty,
      'unit_cost', v_item.avg_cost, 'reason', 'Sales Return'));
  end loop;

  v_total := v_base + v_cgst + v_sgst + v_igst;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_cr_acct := v_party_ledger; v_party_line := p_party;
  else
    v_cr_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', sys_account(p_org,'sales'), 'debit', v_base, 'credit', 0));
  if v_cgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_cgst'), 'debit', v_cgst, 'credit', 0)); end if;
  if v_sgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_sgst'), 'debit', v_sgst, 'credit', 0)); end if;
  if v_igst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_igst'), 'debit', v_igst, 'credit', 0)); end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_id', v_cr_acct, 'party_id', v_party_line, 'debit', 0, 'credit', v_total));
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', v_cogs, 'credit', 0),
      jsonb_build_object('account_id', sys_account(p_org,'cogs'),      'debit', 0,      'credit', v_cogs));
  end if;

  return post_voucher(p_org, 7::smallint, p_date, p_party, p_narration, v_lines, v_stock);
end; $$;
grant execute on function sales_return(uuid, date, uuid, jsonb, text, text) to authenticated;

-- ── 5. purchase_return() — tighten rate guard ─────────────────────────────────
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

    -- ── GUARDS ──
    if v_qty <= 0      then raise exception 'invalid_quantity'; end if;
    if v_qty > 100000  then raise exception 'invalid_quantity'; end if;
    if v_rate <= 0     then raise exception 'invalid_amount'; end if;
    if v_rate > 99999900 then raise exception 'invalid_amount'; end if; -- ← tightened

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
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', -v_qty, 'reason', 'Purchase Return'));
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
