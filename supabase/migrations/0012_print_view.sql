-- =============================================================
-- Extend v_invoice_detail with org identity + party GST fields
-- needed for printing a GST-compliant Tax Invoice.
-- =============================================================

-- Drop first so we can change column list (CREATE OR REPLACE cannot reorder columns)
drop view if exists v_invoice_detail;

create or replace view v_invoice_detail with (security_invoker = on) as
select
  i.org_id,
  i.id            as invoice_id,
  i.invoice_no,
  i.date,
  i.total,
  i.outstanding,
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
