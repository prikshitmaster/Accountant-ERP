# Sales Entry Redesign + Invoice Detail Page

**Date:** 2026-06-03  
**Branch:** feature/sales-entry-redesign  
**Status:** Approved — ready for implementation

---

## Problem

The current Sales page has two weaknesses:
1. The entry form is a basic stacked card — item lines are card-per-row, layout is not desktop-optimised, and does not resemble familiar accounting software (Miracle).
2. There is no invoice detail view — clicking an invoice does nothing; users cannot see what was sold.
3. The DB does not store per-item selling rate, making a complete detail view impossible without a schema change.

---

## Scope

### In scope
- New DB table `invoice_lines` + updated `sell` RPC to populate it
- New DB view `v_invoice_detail`
- Redesigned `SalesPage` — full-width layout, spreadsheet item table
- New `ItemTable` component — spreadsheet-style inline editor
- New `SaleDetailPage` at `/sales/:id`
- New `useInvoiceDetail` query hook
- New route in `App.tsx`

### Out of scope
- Sales Return (credit notes) — separate feature, requires its own voucher type
- Invoice cancel/edit on the detail page
- Purchase page redesign (uses `ItemLines`, unchanged)

---

## Data Model

### New table: `invoice_lines`

```sql
CREATE TABLE invoice_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
  invoice_id    uuid NOT NULL REFERENCES invoices ON DELETE CASCADE,
  stock_item_id uuid NOT NULL REFERENCES stock_items,
  qty           numeric(18,4) NOT NULL,
  rate          bigint NOT NULL,   -- selling price paise/unit
  amount        bigint NOT NULL    -- round(qty * rate)
);
CREATE INDEX ON invoice_lines (invoice_id);
```

**RLS policy (same pattern as all other tables):**
```sql
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member" ON invoice_lines FOR ALL USING (
  org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
);
```

### Updated `sell` RPC

The existing `insert into invoices ...` gains `RETURNING id INTO v_invoice_id` (declare `v_invoice_id uuid`). Then loop over `p_items` again:

```sql
DECLARE v_invoice_id uuid;
...
INSERT INTO invoices (...) VALUES (...) RETURNING id INTO v_invoice_id;

FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
  INSERT INTO invoice_lines (org_id, invoice_id, stock_item_id, qty, rate, amount)
  VALUES (
    p_org, v_invoice_id,
    (it->>'stock_item_id')::uuid,
    (it->>'qty')::numeric,
    (it->>'rate')::bigint,
    round((it->>'qty')::numeric * (it->>'rate')::bigint)
  );
END LOOP;
```

This second loop is inside the `IF p_mode = 'credit'` block — cash/bank sales still do not create invoice rows.

### New view: `v_invoice_detail`

One row per invoice line, with invoice header fields repeated:

```sql
CREATE VIEW v_invoice_detail AS
SELECT
  i.org_id,
  i.id            AS invoice_id,
  i.invoice_no,
  i.date,
  i.total,
  i.outstanding,
  i.party_id,
  p.name          AS party_name,
  v.narration,
  il.id           AS line_id,
  il.stock_item_id,
  si.name         AS item_name,
  si.unit,
  si.gst_rate,
  il.qty,
  il.rate,        -- selling price paise/unit
  il.amount       -- selling amount paise
FROM invoices i
JOIN parties p   ON p.id = i.party_id
JOIN vouchers v  ON v.id = i.voucher_id
JOIN invoice_lines il ON il.invoice_id = i.id
JOIN stock_items si   ON si.id = il.stock_item_id;
```

**Note:** Cash/bank sales do not create an `invoices` row (current behaviour). The detail page is only reachable via the invoices list, so this is consistent.

---

## Frontend Architecture

### New component: `src/components/ItemTable.tsx`

Spreadsheet-style inline editor used only on the Sales entry form.

**Props:**
```ts
type ItemTableProps = {
  items: Item[]
  value: Line[]
  onChange: (lines: Line[]) => void
}
```

**Columns:** `# | Product | Unit (auto) | Qty | Rate (₹) | Amount | [×]`

- Product: `<select>` — picks item, auto-fills rate from `sale_price`, shows unit in Unit column
- Qty: numeric input
- Rate: numeric input, pre-filled from item master
- Amount: computed read-only = qty × rate (formatted ₹)
- `×`: delete row button (hidden if only one row)
- Last row: "+ Add item" link spanning all columns
- Footer row: `Subtotal · GST · Total` spanning amount column

**Behaviour:** Same GST calculation logic as existing `ItemLines`. No card wrappers — pure `<table>` element styled with the existing `.tbl` class.

### Redesigned: `src/features/sales/SalesPage.tsx`

Full-width layout (no two-column card split):

```
┌─────────────────────────────────────────────────────────────┐
│ PageHeader: "Sales" / "Record what you sell..."             │
├─────────────────────────────────────────────────────────────┤
│ [New Sale section — full width Card]                        │
│  Date  │  Payment  │  Party (if credit)                    │
│  ─────────────────────────────────────────────────────────  │
│  ItemTable (spreadsheet)                                    │
│  ─────────────────────────────────────────────────────────  │
│  Narration (optional)    [Save Invoice]                     │
│  ✓ Saved · SI/25-26/0001   ← success flash                 │
├─────────────────────────────────────────────────────────────┤
│ [Invoices section — full width Card]                        │
│  table: No. | Customer | Date | Total | Due                 │
│  (each row clickable → /sales/:id)                          │
└─────────────────────────────────────────────────────────────┘
```

Row click: `navigate('/sales/' + invoice.id)`.  
Cash/bank sales still work (no invoice row, not shown in table — same as before).

### New page: `src/features/sales/SaleDetailPage.tsx`

Route: `/sales/:id` where `:id` = `invoice.id` (UUID).

Layout:
```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to Sales                                             │
│ Invoice SI/25-26/0001          [Paid] / [₹X outstanding]   │
│ Date: 01 Jun 2026 · Customer: Acme Ltd                     │
├─────────────────────────────────────────────────────────────┤
│ read-only ItemTable                                         │
│ Product | Unit | Qty | Rate | GST% | Amount                 │
│ ──────────────────────────────────────────────────────────  │
│                       Subtotal: ₹X,XXX                      │
│                       GST (18%): ₹XXX                       │
│                       Total: ₹X,XXX                         │
├─────────────────────────────────────────────────────────────┤
│ Narration: "..." (if any)                                   │
└─────────────────────────────────────────────────────────────┘
```

**Error state:** If invoice not found or not in org → show "Invoice not found" with back link.  
**Loading state:** Skeleton rows.

### New query hook: `useInvoiceDetail`

```ts
// src/hooks/queries.ts — new addition
export type InvoiceDetailLine = {
  line_id: string; stock_item_id: string; item_name: string
  unit: string; gst_rate: number; qty: number; rate: number; amount: number
}
export type InvoiceDetail = {
  invoice_id: string; invoice_no: string; date: string
  total: number; outstanding: number
  party_id: string; party_name: string; narration: string | null
  lines: InvoiceDetailLine[]
}
export function useInvoiceDetail(orgId: string | null, invoiceId: string | null) { ... }
```

The hook queries `v_invoice_detail` filtered by `org_id` and `invoice_id`, then groups rows into a single `InvoiceDetail` object with a `lines` array.

### Route addition: `src/App.tsx`

```tsx
import { SaleDetailPage } from '@/features/sales/SaleDetailPage'
// inside <Routes>:
<Route path="/sales/:id" element={<SaleDetailPage />} />
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Invoice not found / wrong org | "Invoice not found" message + Back link |
| Network error on detail load | React Query error state with retry |
| Save fails (period locked, etc.) | Existing error display in form (unchanged) |

---

## What is NOT changing

- `ItemLines` component — still used by Purchase page, unchanged
- `PurchasesPage` — unchanged
- `ManufacturePage` — unchanged
- All existing DB views and RPCs (except `sell`)
- Cash/bank sale flow — still works, just doesn't create an invoice row

---

## Migration file

`supabase/migrations/0011_invoice_lines.sql`

Contains:
1. `CREATE TABLE invoice_lines` + index
2. RLS enable + policy
3. `CREATE OR REPLACE FUNCTION sell(...)` — updated version
4. `CREATE VIEW v_invoice_detail`

Applied via `node scripts/run-migrations.mjs` (no `supabase start` needed).
