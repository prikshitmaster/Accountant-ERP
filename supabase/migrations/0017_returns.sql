-- ============================================================
-- Sales Return (Credit Note) + Purchase Return (Debit Note)
-- Voucher type 7 = CREDIT_NOTE, 8 = DEBIT_NOTE
-- ============================================================

create or replace function sales_return(
  p_org      uuid,
  p_date     date,
  p_party    uuid,
  p_items    jsonb,
  p_mode     text    default 'credit',
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
  v_cogs      bigint := 0;
  v_cgst      bigint := 0;
  v_sgst      bigint := 0;
  v_igst      bigint := 0;
  v_total     bigint;
  v_lines     jsonb  := '[]'::jsonb;
  v_stock     jsonb  := '[]'::jsonb;
  v_cr_acct   uuid;
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
        v_cgst := v_cgst + v_gst;
        v_sgst := v_sgst + v_gst;
      end if;
    end if;
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id,
      'qty_change',    v_qty,
      'value_change',  round(v_qty * v_item.avg_cost),
      'reason',        'Sales Return'));
  end loop;

  v_total := v_base + v_cgst + v_sgst + v_igst;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_cr_acct    := v_party_ledger;
    v_party_line := p_party;
  else
    v_cr_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', sys_account(p_org,'sales'), 'debit', v_base, 'credit', 0));
  if v_cgst > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'output_cgst'), 'debit', v_cgst, 'credit', 0));
  end if;
  if v_sgst > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'output_sgst'), 'debit', v_sgst, 'credit', 0));
  end if;
  if v_igst > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'output_igst'), 'debit', v_igst, 'credit', 0));
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_id', v_cr_acct, 'party_id', v_party_line, 'debit', 0, 'credit', v_total));

  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', v_cogs,  'credit', 0),
      jsonb_build_object('account_id', sys_account(p_org,'cogs'),      'debit', 0,       'credit', v_cogs));
  end if;

  return post_voucher(p_org, 7::smallint, p_date, p_party, p_narration, v_lines, v_stock);
end;
$$;


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
    -- stock reduction at avg_cost (tracked by post_voucher stock journal)
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id,
      'qty_change',    -v_qty,
      'reason',        'Purchase Return'));
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

  -- Mirror the purchase entry in reverse:
  -- DR supplier/cash (v_total), CR input GST, CR inventory (v_base)
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
end;
$$;
