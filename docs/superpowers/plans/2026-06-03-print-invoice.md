# Print Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Print button to the invoice detail page that opens a browser print dialog showing a GST-compliant Tax Invoice layout, with no new dependencies.

**Architecture:** A new DB migration extends `v_invoice_detail` with org/party identity fields needed for GSTIN and intra/inter state GST split. A new `InvoicePrint` component renders the Tax Invoice layout (hidden on screen, visible when printing). `SaleDetailPage` gains a Print button and renders the print component. `@media print` CSS hides the app chrome during printing.

**Tech Stack:** Supabase Postgres, React + TypeScript, Tailwind v4 (`print:` variant), lucide-react (Printer icon), `window.print()`.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/0012_print_view.sql` | Extend v_invoice_detail with org_name, org_gstin, org_state_code, party_gstin, party_state_code |
| Modify | `src/hooks/queries.ts` | Add 5 fields to InvoiceDetail type + queryFn mapping |
| Create | `src/features/sales/InvoicePrint.tsx` | Tax Invoice print layout component |
| Modify | `src/features/sales/SaleDetailPage.tsx` | Add Print button + render InvoicePrint |
| Modify | `src/index.css` | @media print rules to hide nav/chrome |

---

## Task 1: DB Migration — extend v_invoice_detail

**Files:**
- Create: `supabase/migrations/0012_print_view.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_print_view.sql`:

```sql
-- =============================================================
-- Extend v_invoice_detail with org identity + party GST fields
-- needed for printing a GST-compliant Tax Invoice.
-- =============================================================

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
```

Note: `si.hsn` is added too (useful to show on the invoice). `org_settings` is LEFT JOIN because a new org may not have settings yet.

- [ ] **Step 2: Apply the migration**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | sed 's/^DATABASE_URL=//')"
node scripts/run-migrations.mjs 0012
```

Expected:
```
Applying 0012_print_view.sql … ok
All migrations applied.
```

- [ ] **Step 3: Verify new columns exist**

```bash
node -e "
import('pg').then(({default:pg})=>{
  const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  c.connect()
    .then(()=>c.query(\"select column_name from information_schema.columns where table_name='v_invoice_detail' order by ordinal_position\"))
    .then(r=>{console.log(r.rows.map(x=>x.column_name));c.end()});
})
"
```

Expected output includes: `org_name`, `org_gstin`, `org_state_code`, `party_gstin`, `party_state_code`, `hsn`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0012_print_view.sql
git commit -m "feat(db): extend v_invoice_detail with org/party identity for print"
```

---

## Task 2: Update InvoiceDetail type + hook

**Files:**
- Modify: `src/hooks/queries.ts`

- [ ] **Step 1: Add 6 new fields to `InvoiceDetail` type**

Find the `InvoiceDetail` type in `src/hooks/queries.ts`. Add these fields after `narration`:

```ts
org_name: string
org_gstin: string | null
org_state_code: string | null
party_gstin: string | null
party_state_code: string | null
```

Also add `hsn` to `InvoiceDetailLine` type (after `unit`):
```ts
hsn: string | null
```

- [ ] **Step 2: Map the new fields in `useInvoiceDetail` queryFn**

In the `queryFn`, in the header object mapping (where `first.party_name` etc. are mapped), add after `narration`:

```ts
org_name:          String(first.org_name ?? ''),
org_gstin:         first.org_gstin   ? String(first.org_gstin)   : null,
org_state_code:    first.org_state_code ? String(first.org_state_code) : null,
party_gstin:       first.party_gstin  ? String(first.party_gstin)  : null,
party_state_code:  first.party_state_code ? String(first.party_state_code) : null,
```

In the `lines` array mapping (where `row.item_name` etc. are mapped), add after `unit`:

```ts
hsn: row.hsn ? String(row.hsn) : null,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 4: Commit**

```bash
git add src/hooks/queries.ts
git commit -m "feat(fe): add org/party identity + HSN fields to InvoiceDetail type"
```

---

## Task 3: InvoicePrint component

**Files:**
- Create: `src/features/sales/InvoicePrint.tsx`

- [ ] **Step 1: Create `src/features/sales/InvoicePrint.tsx`**

```tsx
import type { InvoiceDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'

export function InvoicePrint({ inv }: { inv: InvoiceDetail }) {
  const subtotal = inv.lines.reduce((s, l) => s + l.amount, 0)
  const totalGst = inv.total - subtotal

  const isInter =
    !!inv.org_state_code &&
    !!inv.party_state_code &&
    inv.org_state_code !== inv.party_state_code

  const hasStateInfo = !!inv.org_state_code && !!inv.party_state_code

  return (
    <div className="hidden print:block p-8 text-sm text-black font-sans">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold tracking-wide uppercase">Tax Invoice</h1>
      </div>

      {/* Supplier + Invoice meta */}
      <div className="flex justify-between mb-6">
        <div>
          <p className="font-semibold text-base">{inv.org_name}</p>
          {inv.org_gstin && <p className="text-xs mt-0.5">GSTIN: {inv.org_gstin}</p>}
          {inv.org_state_code && <p className="text-xs">State Code: {inv.org_state_code}</p>}
        </div>
        <div className="text-right">
          <p><span className="font-medium">Invoice No:</span> {inv.invoice_no}</p>
          <p><span className="font-medium">Date:</span> {formatDate(inv.date)}</p>
        </div>
      </div>

      {/* Bill To */}
      <div className="border border-black p-3 mb-6">
        <p className="font-semibold mb-1">Bill To:</p>
        <p className="font-medium">{inv.party_name}</p>
        {inv.party_gstin && <p className="text-xs mt-0.5">GSTIN: {inv.party_gstin}</p>}
        {inv.party_state_code && <p className="text-xs">State Code: {inv.party_state_code}</p>}
      </div>

      {/* Items table */}
      <table className="w-full border-collapse mb-6 text-xs">
        <thead>
          <tr className="border border-black">
            <th className="border border-black p-2 text-left w-6">#</th>
            <th className="border border-black p-2 text-left">Description</th>
            <th className="border border-black p-2 text-left w-16">HSN</th>
            <th className="border border-black p-2 text-right w-12">Qty</th>
            <th className="border border-black p-2 text-left w-12">Unit</th>
            <th className="border border-black p-2 text-right w-20">Rate (₹)</th>
            <th className="border border-black p-2 text-right w-12">GST%</th>
            <th className="border border-black p-2 text-right w-24">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={l.line_id} className="border border-black">
              <td className="border border-black p-2">{i + 1}</td>
              <td className="border border-black p-2">{l.item_name}</td>
              <td className="border border-black p-2">{l.hsn ?? '—'}</td>
              <td className="border border-black p-2 text-right">{Number(l.qty)}</td>
              <td className="border border-black p-2">{l.unit}</td>
              <td className="border border-black p-2 text-right">{formatINR(l.rate, false)}</td>
              <td className="border border-black p-2 text-right">{Number(l.gst_rate) > 0 ? `${l.gst_rate}%` : '—'}</td>
              <td className="border border-black p-2 text-right">{formatINR(l.amount, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mb-6">
        <table className="text-xs">
          <tbody>
            <tr>
              <td className="pr-8 py-1">Subtotal</td>
              <td className="text-right font-mono">{formatINR(subtotal, false)}</td>
            </tr>
            {totalGst > 0 && hasStateInfo && !isInter && (
              <>
                <tr>
                  <td className="pr-8 py-1">CGST</td>
                  <td className="text-right font-mono">{formatINR(Math.floor(totalGst / 2), false)}</td>
                </tr>
                <tr>
                  <td className="pr-8 py-1">SGST</td>
                  <td className="text-right font-mono">{formatINR(totalGst - Math.floor(totalGst / 2), false)}</td>
                </tr>
              </>
            )}
            {totalGst > 0 && hasStateInfo && isInter && (
              <tr>
                <td className="pr-8 py-1">IGST</td>
                <td className="text-right font-mono">{formatINR(totalGst, false)}</td>
              </tr>
            )}
            {totalGst > 0 && !hasStateInfo && (
              <tr>
                <td className="pr-8 py-1">GST</td>
                <td className="text-right font-mono">{formatINR(totalGst, false)}</td>
              </tr>
            )}
            <tr className="border-t border-black font-semibold">
              <td className="pr-8 py-1">Total</td>
              <td className="text-right font-mono">{formatINR(inv.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Narration */}
      {inv.narration && (
        <p className="text-xs text-gray-600 mb-6">Note: {inv.narration}</p>
      )}

      {/* Footer */}
      <div className="border-t border-black pt-3 flex justify-between text-xs text-gray-500">
        <span>This is a computer-generated invoice.</span>
        <span>{inv.org_name}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 3: Commit**

```bash
git add src/features/sales/InvoicePrint.tsx
git commit -m "feat(fe): InvoicePrint — GST Tax Invoice layout for browser print"
```

---

## Task 4: Update SaleDetailPage + print CSS

**Files:**
- Modify: `src/features/sales/SaleDetailPage.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add Print button + InvoicePrint to `SaleDetailPage.tsx`**

Add these two imports at the top of `SaleDetailPage.tsx`:
```tsx
import { Printer } from 'lucide-react'
import { InvoicePrint } from './InvoicePrint'
```

In the success return, find the back button:
```tsx
<button
  onClick={() => navigate('/sales')}
  className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
>
  <ArrowLeft size={16} /> Back to Sales
</button>
```

Replace it with a flex row containing both the back button and the print button:
```tsx
<div className="no-print flex items-center justify-between">
  <button
    onClick={() => navigate('/sales')}
    className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
  >
    <ArrowLeft size={16} /> Back to Sales
  </button>
  <button
    onClick={() => window.print()}
    className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
  >
    <Printer size={16} /> Print
  </button>
</div>
```

Add `no-print` class to the `<PageHeader>` wrapper, the badge `<div>`, and the screen `<Card>`:
```tsx
<div className="no-print">
  <PageHeader ... />
</div>
<div className="no-print flex items-center gap-3">
  {/* badge */}
</div>
<Card className="no-print p-0">
  {/* screen item table */}
</Card>
{inv.narration && (
  <p className="no-print text-sm text-muted">Note: {inv.narration}</p>
)}
```

Add `<InvoicePrint inv={inv} />` as the last element before the closing `</div>` of the success return.

- [ ] **Step 2: Add `@media print` rules to `src/index.css`**

Append to the end of `src/index.css`:

```css
/* ---- Print: show only InvoicePrint, hide app chrome ---- */
@media print {
  nav, aside, header { display: none !important; }
  body { background: white !important; }
  .no-print { display: none !important; }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 4: Commit**

```bash
git add src/features/sales/SaleDetailPage.tsx src/index.css
git commit -m "feat(fe): Print button + @media print rules on invoice detail page"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Open `http://localhost:5173`

- [ ] **Step 2: Create a test invoice**

1. Go to **Sales**
2. Create a sale with at least one item that has a GST rate set
3. Note the voucher number (e.g. `SI/25-26/0001`)
4. Click the invoice row in the list

- [ ] **Step 3: Test the detail page**

1. Confirm "Print" button appears top-right on the detail page
2. Confirm invoice loads with all data

- [ ] **Step 4: Test print**

1. Click "Print" → browser print dialog opens
2. In the print preview: nav sidebar should be GONE, only the Tax Invoice should show
3. Confirm: org name, invoice no, date, customer name, item table, GST breakdown (CGST+SGST or IGST), total
4. Click "Save as PDF" and verify the PDF looks clean
5. Close print dialog → detail page returns to normal (Print button visible again)

- [ ] **Step 5: Commit any polish**

```bash
git add -p
git commit -m "fix(fe): print invoice polish"
```
