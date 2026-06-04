# Sales Orders & Purchase Orders — Design Spec
_2026-06-04_

## Summary

Add Sales Orders (SO) and Purchase Orders (PO) as pre-invoice commitment documents. SOs and POs post **no accounting entries** at creation — they are procurement/sales commitment documents only. Accounting entries are created when an SO is converted to an Invoice or a PO is converted to a Bill (using existing `sell` / `purchase` RPCs). Also adds clickable bill detail pages for Purchases (mirrors existing SaleDetailPage).

---

## 1. Database — `0018_orders.sql`

### Tables

**`sales_orders`**
```
id             uuid PK
org_id         uuid FK orgs(id)
so_no          text  -- SO-00001, unique per org
date           date
party_id       uuid FK parties(id)  -- customer (nullable for cash orders)
delivery_date  date
status         text DEFAULT 'draft'  -- draft | confirmed | invoiced | cancelled
narration      text
discount_amount bigint DEFAULT 0   -- paise
freight_amount  bigint DEFAULT 0   -- paise
linked_voucher_id uuid              -- set when converted to invoice
created_at     timestamptz
```

**`sales_order_lines`**
```
id             uuid PK
so_id          uuid FK sales_orders(id) ON DELETE CASCADE
stock_item_id  uuid FK stock_items(id)
qty            numeric(15,3)
rate           bigint          -- paise per unit
amount         bigint GENERATED ALWAYS AS (round(qty * rate)) STORED
```

**`purchase_orders`** — org_id, po_no (`PO-00001`), date, party_id (supplier, NOT NULL), delivery_date, status (`draft | confirmed | billed | cancelled`), narration, linked_voucher_id (set when billed), created_at. No discount/freight fields — POs just capture commitment quantity and rate.

**`purchase_order_lines`** — mirror of sales_order_lines

### Sequence helpers
`next_so_no(org_id uuid)` — counts existing SOs for the org, returns `SO-00001` formatted string.
`next_po_no(org_id uuid)` — same for POs.

### RLS
Both tables: authenticated users may SELECT/INSERT/UPDATE/DELETE rows where `org_id` in their org memberships (same pattern as existing `vouchers` RLS).

### Views
`v_sales_orders` — joins party name, computes line total: `sum(line amounts) - discount + freight`
`v_purchase_orders` — same for POs

### RPCs (all `SECURITY DEFINER`, granted to `authenticated`)

| RPC | Action |
|-----|--------|
| `create_sales_order(org_id, date, party_id, lines[], delivery_date, narration, discount, freight)` | Inserts SO + lines, returns `{so_id, so_no}` |
| `confirm_sales_order(org_id, so_id)` | `draft → confirmed` |
| `convert_so_to_invoice(org_id, so_id, payment_mode)` | Calls existing `sell` logic with SO lines, marks SO `invoiced`, links `invoice_id`, returns `{voucher_no}` |
| `cancel_sales_order(org_id, so_id)` | `draft|confirmed → cancelled` |
| `create_purchase_order(org_id, date, party_id, lines[], delivery_date, narration)` | Inserts PO + lines, returns `{po_id, po_no}` |
| `confirm_purchase_order(org_id, po_id)` | `draft → confirmed` |
| `convert_po_to_bill(org_id, po_id, payment_mode)` | Calls existing `purchase` logic, marks PO `billed`, returns `{voucher_no}` |
| `cancel_purchase_order(org_id, po_id)` | `draft|confirmed → cancelled` |

---

## 2. Frontend

### Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/sales-orders` | `SalesOrdersPage` | 2-col: new SO form (left) + SO list (right) |
| `/sales-orders/:id` | `SalesOrderDetailPage` | Printable SO doc + action bar |
| `/purchase-orders` | `PurchaseOrdersPage` | 2-col: new PO form (left) + PO list (right) |
| `/purchase-orders/:id` | `PurchaseOrderDetailPage` | Printable PO doc + action bar |
| `/purchases/:id` | `PurchaseDetailPage` | Clickable bill detail (mirrors SaleDetailPage) |

### Files

```
src/features/sales/
  SalesOrdersPage.tsx
  SalesOrderDetailPage.tsx
  SalesOrderPrint.tsx          -- print-only document component

src/features/purchases/
  PurchaseOrdersPage.tsx
  PurchaseOrderDetailPage.tsx
  PurchaseOrderPrint.tsx
  PurchaseDetailPage.tsx       -- bill detail (new)
  PurchasePrint.tsx            -- printable bill document (new)
```

### Hooks / Queries (added to `src/hooks/queries.ts`)

```
useSalesOrders(orgId)
useSalesOrderDetail(orgId, id)
usePurchaseOrders(orgId)
usePurchaseOrderDetail(orgId, id)
useBillDetail(orgId, id)
```

### RPC helpers (added to `src/lib/rpc.ts`)

```
rpc.createSalesOrder(...)
rpc.confirmSalesOrder(orgId, soId)
rpc.convertSoToInvoice(orgId, soId, paymentMode)
rpc.cancelSalesOrder(orgId, soId)
rpc.createPurchaseOrder(...)
rpc.confirmPurchaseOrder(orgId, poId)
rpc.convertPoToBill(orgId, poId, paymentMode)
rpc.cancelPurchaseOrder(orgId, poId)
```

### SalesOrdersPage layout

Left card: **New Sales Order** form
- Date, Customer (select), Delivery Date
- Item lines (reuse `ItemTable`)
- Discount (₹), Freight (₹)
- Subtotal · GST · Total summary row
- Note (optional)
- "Save as Draft" button

Right card: SO list table
- Columns: No. | Customer | Date | Delivery Date | Status badge | Amount
- Click row → `/sales-orders/:id`
- Status badges: Draft (grey) / Confirmed (blue) / Invoiced (green) / Cancelled (red)

### SalesOrderDetailPage layout

**Action bar** (top, no-print):
`← Back` | Status badge | `Confirm` (draft only) | `Convert to Invoice` (confirmed only) + payment mode dropdown | `Cancel` | `Print` | `WhatsApp` | `Email`

**Detail table** (no-print):
Items with qty, rate, GST%, amount — same as SaleDetailPage

**Printable document** (`SalesOrderPrint`):
- Header: **SALES ORDER** (centred, bold)
- Org block (left): name, GSTIN, address, phone, email
- Meta block (right): Sales Order# SO-00001, Date, Delivery Date
- Bill To block: customer name + address
- Items table: # | Item & Description | Qty | Rate | Amount
- Footer: Subtotal / Discount / GST / Freight / Round-off / **Total**
- Authorized Signature line

### PurchaseOrdersPage / PurchaseOrderDetailPage

Identical structure to Sales Order pages, with:
- "Vendor Address" + "Deliver To" blocks (org address used as Deliver To)
- Convert action says "Convert to Bill"
- PO# format: PO-00001

### PurchaseDetailPage (bill detail)

Mirrors `SaleDetailPage`:
- Back to Purchases
- Print button
- Status badge (Paid / Due ₹X)
- Items table with qty, rate, GST%, amount
- `PurchasePrint` component headed **Purchase Bill** — supplier name, bill no, date, items with GST, totals. Print-only, same structural pattern as `InvoicePrint`.

### Sharing — WhatsApp & Email

Both implemented as client-side links on the detail page action bar.

**WhatsApp**: Opens `https://wa.me/?text=<encoded>` with message:
```
Sales Order SO-00001
Customer: Raj Computers
Date: 04/06/2026 | Delivery: 06/06/2026
Items:
  USB Type-C Cable × 10 @ ₹299 = ₹2,990
Total: ₹3,142
```

**Email**: Opens `mailto:<party_email>?subject=Sales Order SO-00001 from <org_name>&body=<same text>`
If party has no email, the button is disabled with tooltip "No email on file".

---

## 3. Navigation

AppShell sidebar update:

```
TRANSACTIONS
  Sales
  Sales Orders    ← new
  Purchases
  Purchase Orders ← new
  Money
```

---

## 4. Scope boundaries (v1)

- **No partial fulfillment** — the full SO/PO converts to invoice/bill at once
- **No goods receipt note (GRN)** — delivery tracking is out of scope
- **No email sending via backend** — sharing uses mailto / wa.me client links only
- **No SO/PO editing after confirmed** — must cancel and re-create
- Bills in Purchases become clickable (new `PurchaseDetailPage`) as part of this work
