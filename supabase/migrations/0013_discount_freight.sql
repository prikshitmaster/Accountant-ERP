-- =============================================================
-- Discount, freight, and round-off on sales invoices.
-- =============================================================

-- ---------- Alter invoices ----------
alter table invoices add column if not exists discount_amount bigint not null default 0;
alter table invoices add column if not exists freight_amount  bigint not null default 0;
alter table invoices add column if not exists round_off       bigint not null default 0;

-- ---------- Updated sell (adds discount, freight, round-off) ----------
create or replace function sell(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_mode text default 'credit', p_narration text default null,
  p_discount bigint default 0, p_freight bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  v_res jsonb;
  v_invoice_id uuid;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  select state_code into v_org_state from org_settings where org_id = p_org;
  if p_party is not null then select state_code into v_party_state from parties where id = p_party and org_id = p_org; end if;
  v_inter := (v_party_state is not null and v_org_state is not null and v_party_state <> v_org_state);

  -- Pass 1: compute base amounts and GST on full (pre-discount) base
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

  -- Scale GST proportionally for trade discount
  if p_discount > 0 and v_base > 0 then
    v_cgst := round(v_cgst::numeric * (v_base - p_discount) / v_base);
    v_sgst := round(v_sgst::numeric * (v_base - p_discount) / v_base);
    v_igst := round(v_igst::numeric * (v_base - p_discount) / v_base);
  end if;

  v_taxable   := v_base - p_discount;
  v_gross     := v_taxable + v_cgst + v_sgst + v_igst + p_freight;
  v_bill      := round(v_gross::numeric / 100) * 100;  -- round to nearest rupee
  v_round_off := v_bill - v_gross;                     -- + collected more, - collected less

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_debit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_debit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  -- Debit debtor/cash for bill amount; credit sales for taxable+freight
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
      values (
        p_org, v_invoice_id,
        (it->>'stock_item_id')::uuid,
        (it->>'qty')::numeric,
        (it->>'rate')::bigint,
        round((it->>'qty')::numeric * (it->>'rate')::bigint)::bigint
      );
    end loop;
  end if;

  return v_res;
end; $$;

-- ---------- Refresh v_invoice_detail with new columns ----------
drop view if exists v_invoice_detail;
create view v_invoice_detail with (security_invoker = on) as
select
  i.org_id,
  i.id            as invoice_id,
  i.invoice_no,
  i.date,
  i.total,
  i.outstanding,
  i.discount_amount,
  i.freight_amount,
  i.round_off,
  i.party_id,
  p.name          as party_name,
  p.gstin         as party_gstin,
  p.state_code    as party_state_code,
  v.narration,
  il.id           as line_id,
  il.stock_item_id,
  si.name         as item_name,
  si.unit,
  si.hsn,
  si.gst_rate,
  il.qty,
  il.rate,
  il.amount,
  o.name          as org_name,
  os.gstin        as org_gstin,
  os.state_code   as org_state_code
from invoices i
join  parties       p  on p.id      = i.party_id
join  vouchers      v  on v.id      = i.voucher_id
join  invoice_lines il on il.invoice_id = i.id
join  stock_items   si on si.id     = il.stock_item_id
join  organizations o  on o.id      = i.org_id
left join org_settings os on os.org_id = i.org_id;

grant select on v_invoice_detail to authenticated;
grant execute on function sell(uuid, date, uuid, jsonb, text, text, bigint, bigint) to authenticated;
