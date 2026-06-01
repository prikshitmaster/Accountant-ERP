-- =============================================================
-- Richer party & item masters. Additive columns + wider RPCs.
-- Group/alias are plain reporting metadata (no constraints, no
-- effect on the ledger account parent). Opening balances post real
-- OPENING vouchers (type 10) through post_voucher. Backward compatible.
-- =============================================================

-- ---------- Additive columns ----------
alter table parties add column if not exists alias            text;
alter table parties add column if not exists group_name       text;
alter table parties add column if not exists area             text;
alter table parties add column if not exists city             text;
alter table parties add column if not exists pincode          text;
alter table parties add column if not exists billing_address  text;
alter table parties add column if not exists shipping_address text;
alter table parties add column if not exists email            text;
alter table parties add column if not exists contact_person   text;
alter table parties add column if not exists pan              text;
alter table parties add column if not exists aadhaar          text;
alter table parties add column if not exists udyam_no         text;
alter table parties add column if not exists msme_activity    text;
alter table parties add column if not exists credit_limit     bigint not null default 0;  -- paise
alter table parties add column if not exists credit_days      int    not null default 0;

alter table stock_items add column if not exists item_code      text;
alter table stock_items add column if not exists category       text;
alter table stock_items add column if not exists description    text;
alter table stock_items add column if not exists sale_price     bigint not null default 0; -- paise
alter table stock_items add column if not exists purchase_price bigint not null default 0; -- paise

-- ---------- create_party (drop old 6-arg, recreate wider) ----------
drop function if exists create_party(uuid, text, text, text, text, text);
create or replace function create_party(
  p_org uuid, p_name text, p_kind text, p_phone text default null,
  p_gstin text default null, p_state_code text default null,
  p_details jsonb default '{}'::jsonb,
  p_opening_amount bigint default 0, p_opening_type text default null,
  p_opening_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_parent uuid; v_group smallint; v_account uuid; v_party uuid;
  v_obe uuid; v_lines jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if p_kind = 'supplier' then v_parent := sys_account(p_org,'creditors'); v_group := 2;
  else                        v_parent := sys_account(p_org,'debtors');   v_group := 1; end if;

  insert into accounts (org_id, name, group_id, parent_id)
    values (p_org, p_name, v_group, v_parent) returning id into v_account;

  insert into parties (
    org_id, name, kind, phone, ledger_account_id, gstin, state_code,
    alias, group_name, area, city, pincode, billing_address, shipping_address,
    email, contact_person, pan, aadhaar, udyam_no, msme_activity, credit_limit, credit_days)
  values (
    p_org, p_name, p_kind, p_phone, v_account, p_gstin, p_state_code,
    p_details->>'alias', p_details->>'group_name', p_details->>'area', p_details->>'city',
    p_details->>'pincode', p_details->>'billing_address', p_details->>'shipping_address',
    p_details->>'email', p_details->>'contact_person', p_details->>'pan', p_details->>'aadhaar',
    p_details->>'udyam_no', p_details->>'msme_activity',
    coalesce((p_details->>'credit_limit')::bigint, 0), coalesce((p_details->>'credit_days')::int, 0))
  returning id into v_party;

  -- audit: name/kind ONLY (never aadhaar/PII)
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CREATE_PARTY', 'party', v_party,
            jsonb_build_object('name', p_name, 'kind', p_kind));

  -- optional opening balance as a real OPENING voucher
  if coalesce(p_opening_amount, 0) > 0 then
    v_obe := sys_account(p_org, 'opening_equity');
    if p_opening_type = 'cr' then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_obe, 'debit', p_opening_amount, 'credit', 0),
        jsonb_build_object('account_id', v_account, 'party_id', v_party, 'debit', 0, 'credit', p_opening_amount));
    else
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_account, 'party_id', v_party, 'debit', p_opening_amount, 'credit', 0),
        jsonb_build_object('account_id', v_obe, 'debit', 0, 'credit', p_opening_amount));
    end if;
    perform post_voucher(p_org, 10::smallint, coalesce(p_opening_date, current_date),
                         v_party, 'Opening balance', v_lines, '[]'::jsonb);
  end if;

  return v_party;
end; $$;

-- ---------- create_stock_item (drop old 7-arg, recreate wider) ----------
drop function if exists create_stock_item(uuid, text, smallint, text, numeric, text, numeric);
create or replace function create_stock_item(
  p_org uuid, p_name text, p_item_type smallint, p_unit text,
  p_min_level numeric default 0, p_hsn text default null, p_gst_rate numeric default 0,
  p_details jsonb default '{}'::jsonb,
  p_opening_qty numeric default 0, p_opening_rate bigint default 0,
  p_opening_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org); v_item uuid;
  v_inv uuid; v_obe uuid; v_val bigint; v_lines jsonb; v_stock jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;

  insert into stock_items (
    org_id, name, item_type, unit, min_level, hsn, gst_rate,
    item_code, category, description, sale_price, purchase_price)
  values (
    p_org, p_name, p_item_type, p_unit, coalesce(p_min_level,0), p_hsn, coalesce(p_gst_rate,0),
    p_details->>'item_code', p_details->>'category', p_details->>'description',
    coalesce((p_details->>'sale_price')::bigint, 0), coalesce((p_details->>'purchase_price')::bigint, 0))
  returning id into v_item;

  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CREATE_STOCK_ITEM', 'stock_item', v_item,
            jsonb_build_object('name', p_name));

  -- optional opening stock as a real OPENING voucher
  if coalesce(p_opening_qty, 0) > 0 then
    v_inv := sys_account(p_org, 'inventory');
    v_obe := sys_account(p_org, 'opening_equity');
    v_val := round(p_opening_qty * coalesce(p_opening_rate, 0));
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_inv, 'debit', v_val, 'credit', 0),
      jsonb_build_object('account_id', v_obe, 'debit', 0, 'credit', v_val));
    v_stock := jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item, 'qty_change', p_opening_qty, 'unit_cost', coalesce(p_opening_rate,0),
      'reason', 'Opening stock'));
    perform post_voucher(p_org, 10::smallint, coalesce(p_opening_date, current_date),
                         null, 'Opening stock', v_lines, v_stock);
  end if;

  return v_item;
end; $$;

-- ---------- v_parties: expose new reporting columns ----------
drop view if exists v_parties;
create view v_parties with (security_invoker = on) as
select
  p.org_id, p.id, p.name, p.kind, p.phone, p.ledger_account_id, p.gstin, p.state_code,
  p.group_name, p.city, p.credit_limit, p.credit_days,
  coalesce((select sum(le.debit - le.credit) from ledger_entries le
            where le.org_id = p.org_id and le.account_id = p.ledger_account_id), 0) as balance
from parties p;

-- ---------- grants ----------
grant select on v_parties to authenticated;
grant execute on function create_party(uuid, text, text, text, text, text, jsonb, bigint, text, date) to authenticated;
grant execute on function create_stock_item(uuid, text, smallint, text, numeric, text, numeric, jsonb, numeric, bigint, date) to authenticated;
