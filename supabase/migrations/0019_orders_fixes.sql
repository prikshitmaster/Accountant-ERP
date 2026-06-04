-- supabase/migrations/0019_orders_fixes.sql
-- Fix error codes, advisory locks, missing grants from 0018_orders.sql

-- Fix confirm_sales_order: wrong error code for non-draft status
create or replace function confirm_sales_order(p_org uuid, p_so uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_status text;
begin
  if v_role is null then raise exception 'not_member'; end if;
  select status into v_status from sales_orders where id = p_so and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_status <> 'draft' then raise exception 'invalid_status'; end if;
  update sales_orders set status = 'confirmed' where id = p_so;
end; $$;
grant execute on function confirm_sales_order to authenticated;

-- Fix confirm_purchase_order: same issue
create or replace function confirm_purchase_order(p_org uuid, p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := org_role(p_org); v_status text;
begin
  if v_role is null then raise exception 'not_member'; end if;
  select status into v_status from purchase_orders where id = p_po and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_status <> 'draft' then raise exception 'invalid_status'; end if;
  update purchase_orders set status = 'confirmed' where id = p_po;
end; $$;
grant execute on function confirm_purchase_order to authenticated;

-- Fix convert_so_to_invoice: distinct error for invoiced vs cancelled + advisory lock
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
  if v_status = 'invoiced' then raise exception 'already_invoiced'; end if;
  if v_status = 'cancelled' then raise exception 'already_cancelled'; end if;
  select jsonb_agg(jsonb_build_object('stock_item_id', sol.stock_item_id, 'qty', sol.qty, 'rate', sol.rate))
    into v_items from sales_order_lines sol where sol.so_id = p_so;
  v_result := sell(p_org, v_date, v_party, v_items, p_payment_mode, v_narration, v_discount, v_freight);
  update sales_orders
    set status = 'invoiced', linked_voucher_id = (v_result->>'voucher_id')::uuid
    where id = p_so;
  return v_result;
end; $$;
grant execute on function convert_so_to_invoice to authenticated;

-- Fix convert_po_to_bill: distinct error for billed vs cancelled
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
  if v_status = 'billed' then raise exception 'already_billed'; end if;
  if v_status = 'cancelled' then raise exception 'already_cancelled'; end if;
  select jsonb_agg(jsonb_build_object('stock_item_id', pol.stock_item_id, 'qty', pol.qty, 'rate', pol.rate))
    into v_items from purchase_order_lines pol where pol.po_id = p_po;
  v_result := purchase(p_org, v_date, v_party, v_items, p_payment_mode, v_narration);
  update purchase_orders
    set status = 'billed', linked_voucher_id = (v_result->>'voucher_id')::uuid
    where id = p_po;
  return v_result;
end; $$;
grant execute on function convert_po_to_bill to authenticated;

-- Fix create_sales_order: advisory lock prevents duplicate SO numbers under concurrency
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
  perform pg_advisory_xact_lock(hashtext(p_org::text || '_so'));
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

-- Fix create_purchase_order: advisory lock prevents duplicate PO numbers under concurrency
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
  perform pg_advisory_xact_lock(hashtext(p_org::text || '_po'));
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

-- Grant execute on sequence helpers
grant execute on function next_so_no(uuid) to authenticated;
grant execute on function next_po_no(uuid) to authenticated;

-- Fix grants on order lines (was missing update and delete)
grant select, insert, update, delete on sales_order_lines to authenticated;
grant select, insert, update, delete on purchase_order_lines to authenticated;
