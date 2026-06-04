-- supabase/migrations/0018_orders.sql
-- ============================================================
-- Sales Orders + Purchase Orders + bill_lines for detail view
-- ============================================================

-- bill_lines: per-item detail for credit purchases (mirrors invoice_lines)
create table if not exists bill_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations on delete cascade,
  bill_id       uuid not null references bills on delete cascade,
  stock_item_id uuid not null references stock_items,
  qty           numeric(18,4) not null,
  rate          bigint not null,
  amount        bigint not null
);
create index if not exists bill_lines_bill_id_idx on bill_lines (bill_id);
alter table bill_lines enable row level security;
create policy "org member" on bill_lines for all using (
  org_id in (select org_id from memberships where user_id = auth.uid())
);
grant select on bill_lines to authenticated;

-- updated purchase() that also inserts into bill_lines
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
  v_bill_id uuid;
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
    v_qty := (it->>'qty')::numeric; v_rate := (it->>'rate')::bigint;
    select gst_rate into v_grate from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base := v_base + v_line_base;
    if v_grate > 0 then
      if v_inter then
        v_igst := v_igst + round(v_line_base * v_grate / 100);
      else
        v_gst := round(v_line_base * (v_grate / 2) / 100);
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
      values (
        p_org, v_bill_id,
        (it->>'stock_item_id')::uuid,
        (it->>'qty')::numeric,
        (it->>'rate')::bigint,
        round((it->>'qty')::numeric * (it->>'rate')::bigint)::bigint
      );
    end loop;
  end if;
  return v_res;
end; $$;
grant execute on function purchase(uuid, date, uuid, jsonb, text, text) to authenticated;

-- v_bill_detail view
create or replace view v_bill_detail with (security_invoker = on) as
select
  b.org_id,
  b.id              as bill_id,
  b.bill_no,
  b.date,
  b.total,
  b.outstanding,
  b.party_id,
  p.name            as party_name,
  p.gstin           as party_gstin,
  p.state_code      as party_state_code,
  v.narration,
  bl.id             as line_id,
  bl.stock_item_id,
  si.name           as item_name,
  si.unit,
  si.hsn,
  si.gst_rate,
  bl.qty,
  bl.rate,
  bl.amount,
  o.name            as org_name,
  os.gstin          as org_gstin,
  os.state_code     as org_state_code,
  os.pan_no         as org_pan_no,
  os.phone          as org_phone,
  os.email          as org_email,
  os.address_line1  as org_address_line1,
  os.address_line2  as org_address_line2,
  os.city           as org_city,
  os.pincode        as org_pincode,
  os.bank_name      as org_bank_name,
  os.bank_account_no as org_bank_account_no,
  os.bank_ifsc      as org_bank_ifsc,
  os.upi            as org_upi
from bills b
join  parties      p  on p.id  = b.party_id
join  vouchers     v  on v.id  = b.voucher_id
join  bill_lines   bl on bl.bill_id = b.id
join  stock_items  si on si.id = bl.stock_item_id
join  organizations o  on o.id = b.org_id
left join org_settings os on os.org_id = b.org_id;

grant select on v_bill_detail to authenticated;

-- sales_orders
create table if not exists sales_orders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations on delete cascade,
  so_no             text not null,
  date              date not null,
  party_id          uuid not null references parties,
  delivery_date     date,
  status            text not null default 'draft'
                    check (status in ('draft','confirmed','invoiced','cancelled')),
  narration         text,
  discount_amount   bigint not null default 0,
  freight_amount    bigint not null default 0,
  linked_voucher_id uuid,
  created_at        timestamptz not null default now(),
  unique (org_id, so_no)
);
create index if not exists sales_orders_org_idx on sales_orders (org_id, date);
alter table sales_orders enable row level security;
create policy "org member" on sales_orders for all using (
  org_id in (select org_id from memberships where user_id = auth.uid())
);
grant select, insert, update on sales_orders to authenticated;

-- sales_order_lines
create table if not exists sales_order_lines (
  id            uuid primary key default gen_random_uuid(),
  so_id         uuid not null references sales_orders on delete cascade,
  stock_item_id uuid not null references stock_items,
  qty           numeric(18,4) not null check (qty > 0),
  rate          bigint not null check (rate >= 0)
);
alter table sales_order_lines enable row level security;
create policy "org member" on sales_order_lines for all using (
  exists (select 1 from sales_orders so
    where so.id = sales_order_lines.so_id
    and so.org_id in (select org_id from memberships where user_id = auth.uid()))
);
grant select, insert on sales_order_lines to authenticated;

-- purchase_orders
create table if not exists purchase_orders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations on delete cascade,
  po_no             text not null,
  date              date not null,
  party_id          uuid not null references parties,
  delivery_date     date,
  status            text not null default 'draft'
                    check (status in ('draft','confirmed','billed','cancelled')),
  narration         text,
  linked_voucher_id uuid,
  created_at        timestamptz not null default now(),
  unique (org_id, po_no)
);
create index if not exists purchase_orders_org_idx on purchase_orders (org_id, date);
alter table purchase_orders enable row level security;
create policy "org member" on purchase_orders for all using (
  org_id in (select org_id from memberships where user_id = auth.uid())
);
grant select, insert, update on purchase_orders to authenticated;

-- purchase_order_lines
create table if not exists purchase_order_lines (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders on delete cascade,
  stock_item_id uuid not null references stock_items,
  qty           numeric(18,4) not null check (qty > 0),
  rate          bigint not null check (rate >= 0)
);
alter table purchase_order_lines enable row level security;
create policy "org member" on purchase_order_lines for all using (
  exists (select 1 from purchase_orders po
    where po.id = purchase_order_lines.po_id
    and po.org_id in (select org_id from memberships where user_id = auth.uid()))
);
grant select, insert on purchase_order_lines to authenticated;

-- Sequence helpers (defined after the tables they reference)
create or replace function next_so_no(p_org uuid) returns text
language sql security definer set search_path = public as $$
  select 'SO-' || lpad(((select count(*) from sales_orders where org_id = p_org) + 1)::text, 5, '0');
$$;

create or replace function next_po_no(p_org uuid) returns text
language sql security definer set search_path = public as $$
  select 'PO-' || lpad(((select count(*) from purchase_orders where org_id = p_org) + 1)::text, 5, '0');
$$;

-- v_sales_orders (list view)
create or replace view v_sales_orders with (security_invoker = on) as
select
  so.id, so.org_id, so.so_no, so.date,
  so.party_id, p.name as party_name,
  so.delivery_date, so.status, so.narration,
  so.discount_amount, so.freight_amount, so.linked_voucher_id, so.created_at,
  greatest(0, coalesce(
    (select sum(sol.qty * sol.rate)::bigint from sales_order_lines sol where sol.so_id = so.id), 0
  ) - so.discount_amount + so.freight_amount) as total
from sales_orders so
join parties p on p.id = so.party_id;
grant select on v_sales_orders to authenticated;

-- v_sales_order_detail (with lines + org info)
create or replace view v_sales_order_detail with (security_invoker = on) as
select
  so.org_id, so.id as so_id, so.so_no, so.date,
  so.party_id, p.name as party_name,
  p.gstin as party_gstin, p.state_code as party_state_code,
  so.delivery_date, so.status, so.narration,
  so.discount_amount, so.freight_amount, so.linked_voucher_id,
  sol.id as line_id, sol.stock_item_id,
  si.name as item_name, si.unit, si.hsn, si.gst_rate,
  sol.qty, sol.rate, (sol.qty * sol.rate)::bigint as amount,
  o.name as org_name,
  os.gstin as org_gstin, os.state_code as org_state_code,
  os.phone as org_phone, os.email as org_email,
  os.address_line1 as org_address_line1, os.address_line2 as org_address_line2,
  os.city as org_city, os.pincode as org_pincode
from sales_orders so
join  parties           p   on p.id    = so.party_id
join  sales_order_lines sol on sol.so_id = so.id
join  stock_items       si  on si.id   = sol.stock_item_id
join  organizations     o   on o.id    = so.org_id
left join org_settings  os  on os.org_id = so.org_id;
grant select on v_sales_order_detail to authenticated;

-- v_purchase_orders (list view)
create or replace view v_purchase_orders with (security_invoker = on) as
select
  po.id, po.org_id, po.po_no, po.date,
  po.party_id, p.name as party_name,
  po.delivery_date, po.status, po.narration,
  po.linked_voucher_id, po.created_at,
  coalesce(
    (select sum(pol.qty * pol.rate)::bigint from purchase_order_lines pol where pol.po_id = po.id), 0
  ) as total
from purchase_orders po
join parties p on p.id = po.party_id;
grant select on v_purchase_orders to authenticated;

-- v_purchase_order_detail (with lines + org info)
create or replace view v_purchase_order_detail with (security_invoker = on) as
select
  po.org_id, po.id as po_id, po.po_no, po.date,
  po.party_id, p.name as party_name,
  p.gstin as party_gstin, p.state_code as party_state_code,
  po.delivery_date, po.status, po.narration, po.linked_voucher_id,
  pol.id as line_id, pol.stock_item_id,
  si.name as item_name, si.unit, si.hsn, si.gst_rate,
  pol.qty, pol.rate, (pol.qty * pol.rate)::bigint as amount,
  o.name as org_name,
  os.gstin as org_gstin, os.state_code as org_state_code,
  os.phone as org_phone, os.email as org_email,
  os.address_line1 as org_address_line1, os.address_line2 as org_address_line2,
  os.city as org_city, os.pincode as org_pincode
from purchase_orders po
join  parties              p   on p.id   = po.party_id
join  purchase_order_lines pol on pol.po_id = po.id
join  stock_items          si  on si.id  = pol.stock_item_id
join  organizations        o   on o.id   = po.org_id
left join org_settings     os  on os.org_id = po.org_id;
grant select on v_purchase_order_detail to authenticated;

-- 8 RPCs

-- create_sales_order
create or replace function create_sales_order(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_delivery_date date default null, p_narration text default null,
  p_discount bigint default 0, p_freight bigint default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_so_no text; v_so_id uuid; it jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  v_so_no := next_so_no(p_org);
  insert into sales_orders (org_id, so_no, date, party_id, delivery_date, narration, discount_amount, freight_amount)
    values (p_org, v_so_no, p_date, p_party, p_delivery_date, p_narration, p_discount, p_freight)
    returning id into v_so_id;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into sales_order_lines (so_id, stock_item_id, qty, rate)
      values (v_so_id, (it->>'stock_item_id')::uuid, (it->>'qty')::numeric, (it->>'rate')::bigint);
  end loop;
  return jsonb_build_object('so_id', v_so_id, 'so_no', v_so_no);
end; $$;
grant execute on function create_sales_order to authenticated;

-- confirm_sales_order
create or replace function confirm_sales_order(p_org uuid, p_so uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_status text;
begin
  if v_role is null then raise exception 'not_member'; end if;
  select status into v_status from sales_orders where id = p_so and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_status <> 'draft' then raise exception 'already_cancelled'; end if;
  update sales_orders set status = 'confirmed' where id = p_so;
end; $$;
grant execute on function confirm_sales_order to authenticated;

-- cancel_sales_order
create or replace function cancel_sales_order(p_org uuid, p_so uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_status text;
begin
  if v_role is null then raise exception 'not_member'; end if;
  select status into v_status from sales_orders where id = p_so and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_status in ('invoiced','cancelled') then raise exception 'already_cancelled'; end if;
  update sales_orders set status = 'cancelled' where id = p_so;
end; $$;
grant execute on function cancel_sales_order to authenticated;

-- convert_so_to_invoice
create or replace function convert_so_to_invoice(
  p_org uuid, p_so uuid, p_payment_mode text default 'credit'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_status text; v_party uuid; v_date date; v_discount bigint; v_freight bigint; v_narration text;
  v_items jsonb; v_result jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  select status, party_id, date, discount_amount, freight_amount, narration
    into v_status, v_party, v_date, v_discount, v_freight, v_narration
    from sales_orders where id = p_so and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_status in ('invoiced','cancelled') then raise exception 'already_cancelled'; end if;
  select jsonb_agg(jsonb_build_object('stock_item_id', sol.stock_item_id, 'qty', sol.qty, 'rate', sol.rate))
    into v_items from sales_order_lines sol where sol.so_id = p_so;
  v_result := sell(p_org, v_date, v_party, v_items, p_payment_mode, v_narration, v_discount, v_freight);
  update sales_orders
    set status = 'invoiced', linked_voucher_id = (v_result->>'voucher_id')::uuid
    where id = p_so;
  return v_result;
end; $$;
grant execute on function convert_so_to_invoice to authenticated;

-- create_purchase_order
create or replace function create_purchase_order(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_delivery_date date default null, p_narration text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_po_no text; v_po_id uuid; it jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  v_po_no := next_po_no(p_org);
  insert into purchase_orders (org_id, po_no, date, party_id, delivery_date, narration)
    values (p_org, v_po_no, p_date, p_party, p_delivery_date, p_narration)
    returning id into v_po_id;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into purchase_order_lines (po_id, stock_item_id, qty, rate)
      values (v_po_id, (it->>'stock_item_id')::uuid, (it->>'qty')::numeric, (it->>'rate')::bigint);
  end loop;
  return jsonb_build_object('po_id', v_po_id, 'po_no', v_po_no);
end; $$;
grant execute on function create_purchase_order to authenticated;

-- confirm_purchase_order
create or replace function confirm_purchase_order(p_org uuid, p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_status text;
begin
  if v_role is null then raise exception 'not_member'; end if;
  select status into v_status from purchase_orders where id = p_po and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_status <> 'draft' then raise exception 'already_cancelled'; end if;
  update purchase_orders set status = 'confirmed' where id = p_po;
end; $$;
grant execute on function confirm_purchase_order to authenticated;

-- cancel_purchase_order
create or replace function cancel_purchase_order(p_org uuid, p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_status text;
begin
  if v_role is null then raise exception 'not_member'; end if;
  select status into v_status from purchase_orders where id = p_po and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_status in ('billed','cancelled') then raise exception 'already_cancelled'; end if;
  update purchase_orders set status = 'cancelled' where id = p_po;
end; $$;
grant execute on function cancel_purchase_order to authenticated;

-- convert_po_to_bill
create or replace function convert_po_to_bill(
  p_org uuid, p_po uuid, p_payment_mode text default 'credit'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_status text; v_party uuid; v_date date; v_narration text;
  v_items jsonb; v_result jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  select status, party_id, date, narration
    into v_status, v_party, v_date, v_narration
    from purchase_orders where id = p_po and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_status in ('billed','cancelled') then raise exception 'already_cancelled'; end if;
  select jsonb_agg(jsonb_build_object('stock_item_id', pol.stock_item_id, 'qty', pol.qty, 'rate', pol.rate))
    into v_items from purchase_order_lines pol where pol.po_id = p_po;
  v_result := purchase(p_org, v_date, v_party, v_items, p_payment_mode, v_narration);
  update purchase_orders
    set status = 'billed', linked_voucher_id = (v_result->>'voucher_id')::uuid
    where id = p_po;
  return v_result;
end; $$;
grant execute on function convert_po_to_bill to authenticated;
