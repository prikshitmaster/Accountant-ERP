# Print Invoice (Tax Invoice PDF) Design

**Date:** 2026-06-03  
**Status:** Approved — ready for implementation

---

## Problem

After recording a sale, users need to hand a physical or digital Tax Invoice to the customer. Currently there is no print/PDF button. Every Indian SME does this for every sale.

---

## Scope

### In scope
- "Print" button on `SaleDetailPage`
- `InvoicePrint` component — GST-compliant Tax Invoice layout, hidden on screen, shown only when printing
- `@media print` CSS rules — hides nav/sidebar/UI chrome during print
- Updated `v_invoice_detail` view — adds org name, org GSTIN, org state code, party GSTIN, party state code (needed for CGST/SGST vs IGST split)
- Updated `InvoiceDetail` type + hook to carry the 5 new fields

### Out of scope
- Downloadable PDF file generation (browser Save as PDF covers this)
- Email/WhatsApp sharing
- Invoice template customisation
- Purchase bill print

---

## Data Model

### Migration `0012_print_view.sql`

`CREATE OR REPLACE VIEW v_invoice_detail` — extend existing view with 5 new columns:

```sql
o.name          as org_name,
os.gstin        as org_gstin,        -- nullable
os.state_code   as org_state_code,   -- nullable
p.gstin         as party_gstin,      -- nullable
p.state_code    as party_state_code  -- nullable
```

New joins added to the view:
```sql
join  organizations o  on o.id  = i.org_id
left join org_settings os on os.org_id = i.org_id
```

(`parties p` is already joined — just add two more select columns from it.)

No new tables. No RLS changes. No RPC changes.

---

## Frontend Architecture

### Updated `InvoiceDetail` type (`src/hooks/queries.ts`)

Add 5 fields:
```ts
org_name: string
org_gstin: string | null
org_state_code: string | null
party_gstin: string | null
party_state_code: string | null
```

Map from view rows in `queryFn` using `String(first.org_name)` etc.

### New component: `src/features/sales/InvoicePrint.tsx`

- Props: `{ inv: InvoiceDetail }`
- Tailwind class on root div: `hidden print:block` — invisible on screen, block during print
- GST logic:
  - `isInter = !!inv.org_state_code && !!inv.party_state_code && inv.org_state_code !== inv.party_state_code`
  - `totalGst = inv.total - subtotal`
  - If intra-state: CGST = totalGst / 2, SGST = totalGst / 2
  - If inter-state: IGST = totalGst
  - If state codes unknown: show GST as single line

**Print layout:**
```
┌─────────────────────────────────────────────────────┐
│                   TAX INVOICE                       │
├─────────────────────────────────────────────────────┤
│ [Supplier]               [Invoice Details]          │
│ {org_name}               No: SI/25-26/0001          │
│ GSTIN: {org_gstin}       Date: 01 Jun 2026          │
│ State: {org_state_code}                             │
├─────────────────────────────────────────────────────┤
│ Bill To:                                            │
│ {party_name}                                        │
│ GSTIN: {party_gstin}                               │
│ State: {party_state_code}                           │
├──┬──────────────┬──────┬──────┬──────┬──────┬──────┤
│# │ Item         │ HSN  │ Qty  │ Unit │ Rate │ Amt  │
├──┼──────────────┼──────┼──────┼──────┼──────┼──────┤
│  │              │      │      │      │      │      │
├──┴──────────────┴──────┴──────┴──────┴──────┴──────┤
│                              Subtotal: ₹X,XXX       │
│                              CGST X%:   ₹XXX        │
│                              SGST X%:   ₹XXX        │
│                              Total:    ₹X,XXX       │
├─────────────────────────────────────────────────────┤
│ Note: {narration}        This is a computer-        │
│                          generated invoice          │
└─────────────────────────────────────────────────────┘
```

Styled with inline Tailwind classes — no external CSS needed beyond `hidden print:block` on root.

### Modified: `src/features/sales/SaleDetailPage.tsx`

- Import `Printer` from `lucide-react`, `InvoicePrint`
- Add Print button next to the back button row:
  ```tsx
  <button onClick={() => window.print()} className="...">
    <Printer size={16} /> Print
  </button>
  ```
- Render `<InvoicePrint inv={inv} />` at end of success return (after narration)

### `src/index.css` — print media rules

Append at end of file:
```css
@media print {
  /* hide app chrome */
  nav, aside { display: none !important; }
  /* reset page background */
  body { background: white !important; }
  /* hide interactive elements */
  .no-print { display: none !important; }
}
```

Add `no-print` class to: back button, Print button, badge row, PageHeader, screen-only Card (the item table card).

The `InvoicePrint` component root uses `hidden print:block` — Tailwind v4 supports `print:` variant natively.

---

## What Does NOT Change

- `SalesPage` — untouched
- `ItemTable`, `ItemLines` — untouched
- All other RPCs and DB tables — untouched
- Purchase page — untouched

---

## Migration file

`supabase/migrations/0012_print_view.sql`

Contains only `CREATE OR REPLACE VIEW v_invoice_detail` with the 5 additional columns and 2 additional joins. Applied via `node scripts/run-migrations.mjs 0012`.
