-- =============================================================
-- Company profile: add contact, address, bank details to org_settings.
-- Refresh v_invoice_detail to carry all org fields.
-- =============================================================

alter table org_settings
  add column if not exists phone           text,
  add column if not exists email           text,
  add column if not exists address_line1   text,
  add column if not exists address_line2   text,
  add column if not exists city            text,
  add column if not exists pincode         text,
  add column if not exists pan_no          text,
  add column if not exists bank_name       text,
  add column if not exists bank_account_no text,
  add column if not exists bank_ifsc       text,
  add column if not exists upi             text;

-- Refresh view (drop required because column order changes)
drop view if exists v_invoice_detail;
create view v_invoice_detail with (security_invoker = on) as
select
  i.org_id,
  i.id              as invoice_id,
  i.invoice_no,
  i.date,
  i.total,
  i.outstanding,
  i.discount_amount,
  i.freight_amount,
  i.round_off,
  i.party_id,
  p.name            as party_name,
  p.gstin           as party_gstin,
  p.state_code      as party_state_code,
  v.narration,
  il.id             as line_id,
  il.stock_item_id,
  si.name           as item_name,
  si.unit,
  si.hsn,
  si.gst_rate,
  il.qty,
  il.rate,
  il.amount,
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
from invoices i
join  parties       p  on p.id      = i.party_id
join  vouchers      v  on v.id      = i.voucher_id
join  invoice_lines il on il.invoice_id = i.id
join  stock_items   si on si.id     = il.stock_item_id
join  organizations o  on o.id      = i.org_id
left join org_settings os on os.org_id = i.org_id;

grant select on v_invoice_detail to authenticated;
