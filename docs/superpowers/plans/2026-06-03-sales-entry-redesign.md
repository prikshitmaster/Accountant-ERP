# Sales Entry Redesign + Invoice Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Sales entry form to a full-width spreadsheet-style layout (like Miracle accounting software) and add a `/sales/:id` detail page that shows every item line with qty, rate, and amount.

**Architecture:** A new DB migration adds `invoice_lines` (per-item selling data) and updates the `sell` RPC to populate it, plus a `v_invoice_detail` view. On the frontend, a new `ItemTable` component replaces the card-per-row `ItemLines` in the Sales form only; a new `SaleDetailPage` renders at `/sales/:id`. `ItemLines`, PurchasesPage, and ManufacturePage are untouched.

**Tech Stack:** Supabase Postgres (via `node scripts/run-migrations.mjs`), React + TypeScript, TanStack Query, React Router, Tailwind v4, existing `.tbl` / `.num` CSS classes.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/0011_invoice_lines.sql` | New table, RLS, updated sell RPC, v_invoice_detail view |
| Modify | `src/hooks/queries.ts` | Add `InvoiceDetailLine`, `InvoiceDetail` types + `useInvoiceDetail` hook |
| Create | `src/components/ItemTable.tsx` | Spreadsheet table editor for Sales form |
| Modify | `src/features/sales/SalesPage.tsx` | Full-width layout, use ItemTable, clickable invoice rows |
| Create | `src/features/sales/SaleDetailPage.tsx` | Read-only invoice detail view |
| Modify | `src/App.tsx` | Add `/sales/:id` route |

---

## Task 1: DB Migration — invoice_lines, updated sell, v_invoice_detail

**Files:**
- Create: `supabase/migrations/0011_invoice_lines.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0011_invoice_lines.sql` with this exact content:

```sql
-- =============================================================
-- invoice_lines: per-item selling detail for credit sales.
-- Enables full invoice detail view (qty + rate per item).
-- =============================================================

-- ---------- Table ----------
create table if not exists invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations on delete cascade,
  invoice_id    uuid not null references invoices on delete cascade,
  stock_item_id uuid not null references stock_items,
  qty           numeric(18,4) not null,
  rate          bigint not null,   -- selling price paise/unit
  amount        bigint not null    -- round(qty * rate)
);
create index if not exists invoice_lines_invoice_id_idx on invoice_lines (invoice_id);

-- ---------- RLS ----------
alter table invoice_lines enable row level security;
create policy "org member" on invoice_lines for all using (
  org_id in (select org_id from memberships where user_id = auth.uid())
);
grant select, insert, update, delete on invoice_lines to authenticated;

-- ---------- Updated sell (GST-aware + populates invoice_lines) ----------
create or replace function sell(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_mode text default 'credit', p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb; v_item stock_items%rowtype;
  v_qty numeric(18,4); v_rate bigint; v_line_base bigint; v_gst bigint;
  v_base bigint := 0; v_cogs bigint := 0;
  v_cgst bigint := 0; v_sgst bigint := 0; v_igst bigint := 0; v_total bigint;
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
  v_total := v_base + v_cgst + v_sgst + v_igst;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_debit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_debit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_debit_acct, 'party_id', v_party_line, 'debit', v_total, 'credit', 0),
    jsonb_build_object('account_id', sys_account(p_org,'sales'), 'debit', 0, 'credit', v_base));
  if v_cgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_cgst'), 'debit', 0, 'credit', v_cgst)); end if;
  if v_sgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_sgst'), 'debit', 0, 'credit', v_sgst)); end if;
  if v_igst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_igst'), 'debit', 0, 'credit', v_igst)); end if;
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'cogs'),      'debit', v_cogs, 'credit', 0),
      jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', 0,      'credit', v_cogs));
  end if;

  v_res := post_voucher(p_org, 1::smallint, p_date, p_party, p_narration, v_lines, v_stock);

  if p_mode = 'credit' then
    insert into invoices (org_id, party_id, voucher_id, invoice_no, date, total, outstanding)
      values (p_org, p_party, (v_res->>'voucher_id')::uuid, v_res->>'voucher_no', p_date, v_total, v_total)
      returning id into v_invoice_id;

    for it in select * from jsonb_array_elements(p_items) loop
      insert into invoice_lines (org_id, invoice_id, stock_item_id, qty, rate, amount)
      values (
        p_org,
        v_invoice_id,
        (it->>'stock_item_id')::uuid,
        (it->>'qty')::numeric,
        (it->>'rate')::bigint,
        round((it->>'qty')::numeric * (it->>'rate')::bigint)
      );
    end loop;
  end if;

  return v_res;
end; $$;

-- ---------- View: v_invoice_detail ----------
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
  v.narration,
  il.id           as line_id,
  il.stock_item_id,
  si.name         as item_name,
  si.unit,
  si.gst_rate,
  il.qty,
  il.rate,
  il.amount
from invoices i
join parties p        on p.id  = i.party_id
join vouchers v       on v.id  = i.voucher_id
join invoice_lines il on il.invoice_id = i.id
join stock_items si   on si.id = il.stock_item_id;

grant select on v_invoice_detail to authenticated;
grant execute on function sell(uuid, date, uuid, jsonb, text, text) to authenticated;
```

- [ ] **Step 2: Apply the migration**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | sed 's/^DATABASE_URL=//')"
node scripts/run-migrations.mjs 0011
```

Expected output:
```
Applying 0011_invoice_lines.sql … ok

All migrations applied.
```

- [ ] **Step 3: Verify the table and view exist**

```bash
node -e "
import('pg').then(({default:pg})=>{
  const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  c.connect().then(()=>c.query(\"select table_name from information_schema.tables where table_name in ('invoice_lines') and table_schema='public'\")).then(r=>{console.log('Tables:',r.rows);return c.query(\"select viewname from pg_views where viewname='v_invoice_detail'\")}).then(r=>{console.log('Views:',r.rows);c.end()});
})
"
```

Expected output:
```
Tables: [ { table_name: 'invoice_lines' } ]
Views: [ { viewname: 'v_invoice_detail' } ]
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_invoice_lines.sql
git commit -m "feat(db): invoice_lines table + updated sell RPC + v_invoice_detail view"
```

---

## Task 2: `useInvoiceDetail` query hook

**Files:**
- Modify: `src/hooks/queries.ts` (append to end of file)

- [ ] **Step 1: Add types and hook to `src/hooks/queries.ts`**

Append these lines to the end of `src/hooks/queries.ts`:

```ts
export type InvoiceDetailLine = {
  line_id: string
  stock_item_id: string
  item_name: string
  unit: string
  gst_rate: number
  qty: number
  rate: number   // paise per unit
  amount: number // paise
}

export type InvoiceDetail = {
  invoice_id: string
  invoice_no: string
  date: string
  total: number
  outstanding: number
  party_id: string
  party_name: string
  narration: string | null
  lines: InvoiceDetailLine[]
}

export function useInvoiceDetail(orgId: string | null, invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoice_detail', orgId, invoiceId],
    enabled: !!orgId && !!invoiceId,
    queryFn: async (): Promise<InvoiceDetail | null> => {
      const { data, error } = await supabase
        .from('v_invoice_detail')
        .select('*')
        .eq('org_id', orgId)
        .eq('invoice_id', invoiceId)
      if (error) throw error
      if (!data || data.length === 0) return null
      const first = data[0] as Record<string, unknown>
      return {
        invoice_id:  first.invoice_id  as string,
        invoice_no:  first.invoice_no  as string,
        date:        first.date        as string,
        total:       first.total       as number,
        outstanding: first.outstanding as number,
        party_id:    first.party_id    as string,
        party_name:  first.party_name  as string,
        narration:   first.narration   as string | null,
        lines: data.map((r) => {
          const row = r as Record<string, unknown>
          return {
            line_id:       row.line_id       as string,
            stock_item_id: row.stock_item_id as string,
            item_name:     row.item_name     as string,
            unit:          row.unit          as string,
            gst_rate:      Number(row.gst_rate),
            qty:           Number(row.qty),
            rate:          row.rate          as number,
            amount:        row.amount        as number,
          }
        }),
      }
    },
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs` (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/queries.ts
git commit -m "feat(fe): useInvoiceDetail hook + InvoiceDetail types"
```

---

## Task 3: `ItemTable` component — spreadsheet editor

**Files:**
- Create: `src/components/ItemTable.tsx`

- [ ] **Step 1: Create `src/components/ItemTable.tsx`**

```tsx
import { Trash2, Plus } from 'lucide-react'
import type { Item } from '@/hooks/queries'
import { formatINR, rupeesToPaise } from '@/lib/money'

export type Line = { stock_item_id: string; qty: string; rate: string }
export const emptyLine = (): Line => ({ stock_item_id: '', qty: '', rate: '' })

const basePaise = (l: Line) =>
  Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0'))

const gstPaise = (l: Line, items: Item[]) => {
  const it = items.find((i) => i.id === l.stock_item_id)
  return it ? Math.round((basePaise(l) * Number(it.gst_rate)) / 100) : 0
}

export function ItemTable({
  items,
  value,
  onChange,
}: {
  items: Item[]
  value: Line[]
  onChange: (lines: Line[]) => void
}) {
  const set = (i: number, patch: Partial<Line>) =>
    onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const add = () => onChange([...value, emptyLine()])
  const remove = (i: number) => {
    if (value.length === 1) return
    onChange(value.filter((_, idx) => idx !== i))
  }

  const subtotal = value.reduce((s, l) => s + basePaise(l), 0)
  const gst      = value.reduce((s, l) => s + gstPaise(l, items), 0)

  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-8">#</th>
            <th>Product</th>
            <th className="w-20">Unit</th>
            <th className="r w-24">Qty</th>
            <th className="r w-28">Rate (₹)</th>
            <th className="r w-28">Amount</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {value.map((l, i) => {
            const it = items.find((x) => x.id === l.stock_item_id)
            const amt = basePaise(l)
            return (
              <tr key={i}>
                <td className="num text-muted">{i + 1}</td>
                <td>
                  <select
                    className="w-full bg-transparent text-sm outline-none"
                    value={l.stock_item_id}
                    onChange={(e) => {
                      const picked = items.find((x) => x.id === e.target.value)
                      const prefill = picked?.sale_price ? String(picked.sale_price / 100) : l.rate
                      set(i, { stock_item_id: e.target.value, rate: prefill || '' })
                    }}
                  >
                    <option value="" disabled>Select item…</option>
                    {items.map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                  </select>
                </td>
                <td className="text-muted text-sm">{it?.unit ?? '—'}</td>
                <td className="r">
                  <input
                    className="w-full bg-transparent text-right text-sm num outline-none"
                    inputMode="decimal"
                    value={l.qty}
                    placeholder="0"
                    onChange={(e) => set(i, { qty: e.target.value })}
                  />
                </td>
                <td className="r">
                  <input
                    className="w-full bg-transparent text-right text-sm num outline-none"
                    inputMode="decimal"
                    value={l.rate}
                    placeholder="0.00"
                    onChange={(e) => set(i, { rate: e.target.value })}
                  />
                </td>
                <td className="r num text-sm">{amt > 0 ? formatINR(amt, false) : '—'}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={value.length === 1}
                    className="text-muted hover:text-neg disabled:opacity-20"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
          <tr>
            <td colSpan={7}>
              <button
                type="button"
                onClick={add}
                className="flex items-center gap-1 text-sm font-medium text-brand-600"
              >
                <Plus size={14} /> Add item
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="r text-sm text-muted pt-2">Subtotal</td>
            <td className="r num text-sm pt-2">{formatINR(subtotal, false)}</td>
            <td />
          </tr>
          {gst > 0 && (
            <tr>
              <td colSpan={5} className="r text-sm text-muted">GST</td>
              <td className="r num text-sm">{formatINR(gst, false)}</td>
              <td />
            </tr>
          )}
          <tr>
            <td colSpan={5} className="r text-sm font-semibold">Total</td>
            <td className="r num text-sm font-semibold">{formatINR(subtotal + gst)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ItemTable.tsx
git commit -m "feat(fe): ItemTable — spreadsheet-style item editor for Sales"
```

---

## Task 4: Redesign `SalesPage`

**Files:**
- Modify: `src/features/sales/SalesPage.tsx`

- [ ] **Step 1: Replace `src/features/sales/SalesPage.tsx` entirely**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useParties, useItems, useInvoices } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { ItemTable, emptyLine, type Line } from '@/components/ItemTable'
import { PageHeader } from '@/components/ui/PageHeader'

const today = () => new Date().toISOString().slice(0, 10)

export function SalesPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: customers = [] } = useParties(currentOrgId, 'customer')
  const { data: items = [] } = useItems(currentOrgId)
  const { data: invoices = [] } = useInvoices(currentOrgId)
  const partyName = (id: string) => customers.find((p) => p.id === id)?.name ?? '—'

  const [date, setDate] = useState(today())
  const [mode, setMode] = useState<'credit' | 'cash' | 'bank'>('credit')
  const [party, setParty] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [narration, setNarration] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedParty = customers.find((p) => p.id === party)
  const linesTotalPaise = lines.reduce(
    (s, l) => s + Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0')),
    0,
  )
  const overLimit =
    mode === 'credit' &&
    selectedParty &&
    selectedParty.credit_limit > 0 &&
    selectedParty.balance + linesTotalPaise > selectedParty.credit_limit

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = lines
      .filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setError('Add at least one item.'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.sell(currentOrgId, date, mode === 'credit' ? party : null, payload, mode, narration)
      setMsg(`Saved · ${res.voucher_no}`)
      setLines([emptyLine()]); setNarration('')
      ;['dashboard', 'daybook', 'invoices', 'items', 'parties', 'trial_balance', 'gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Sales" description="Record what you sell and keep track of who still owes you." />

      <Card>
        <h3 className="mb-4 font-semibold">New sale</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Payment">
              <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="credit">On credit</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </Select>
            </Field>
            {mode === 'credit' && (
              <Field label="Customer">
                <Select required value={party} onChange={(e) => setParty(e.target.value)}>
                  <option value="" disabled>Select customer…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
          </div>

          <ItemTable items={items} value={lines} onChange={setLines} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Field label="Note (optional)" hint="">
              <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Narration…" />
            </Field>
            <div className="shrink-0">
              <Button type="submit" size="lg" disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</Button>
            </div>
          </div>

          {overLimit && (
            <p className="text-sm text-warn">
              ⚠ This sale puts {selectedParty!.name} over their credit limit
              ({formatINR(selectedParty!.credit_limit)}). You can still save.
            </p>
          )}
          {error && <p className="text-sm text-neg">{error}</p>}
          {msg && <p className="text-sm text-pos">{msg}</p>}
        </form>
      </Card>

      <Card className="p-0">
        <h3 className="border-b border-line p-4 font-semibold">Invoices</h3>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>No.</th>
                <th>Customer</th>
                <th>Date</th>
                <th className="r">Total</th>
                <th className="r">Due</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/sales/${inv.id}`)}
                >
                  <td className="num">{inv.invoice_no}</td>
                  <td>{partyName(inv.party_id)}</td>
                  <td className="num">{formatDate(inv.date)}</td>
                  <td className="r num">{formatINR(inv.total, false)}</td>
                  <td className={`r num ${inv.outstanding > 0 ? 'text-warn' : 'text-pos'}`}>
                    {inv.outstanding > 0 ? formatINR(inv.outstanding, false) : 'Paid'}
                  </td>
                </tr>
              ))}
              {!invoices.length && (
                <tr><td colSpan={5} className="py-6 text-center text-muted">No invoices yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/sales/SalesPage.tsx
git commit -m "feat(fe): redesign SalesPage — full-width, spreadsheet ItemTable, clickable invoice rows"
```

---

## Task 5: `SaleDetailPage`

**Files:**
- Create: `src/features/sales/SaleDetailPage.tsx`

- [ ] **Step 1: Create `src/features/sales/SaleDetailPage.tsx`**

```tsx
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useInvoiceDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'

export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useAuth()
  const navigate = useNavigate()
  const { data: inv, isLoading, isError } = useInvoiceDetail(currentOrgId, id ?? null)

  if (isLoading) {
    return (
      <div className="space-y-5">
        <button onClick={() => navigate('/sales')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to Sales
        </button>
        <p className="text-muted">Loading…</p>
      </div>
    )
  }

  if (isError || !inv) {
    return (
      <div className="space-y-5">
        <button onClick={() => navigate('/sales')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to Sales
        </button>
        <p className="text-neg">Invoice not found.</p>
      </div>
    )
  }

  const subtotal = inv.lines.reduce((s, l) => s + l.amount, 0)
  const gst      = inv.total - subtotal
  const isPaid   = inv.outstanding === 0

  return (
    <div className="space-y-5">
      <button
        onClick={() => navigate('/sales')}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={16} /> Back to Sales
      </button>

      <PageHeader
        title={`Invoice ${inv.invoice_no}`}
        description={`${formatDate(inv.date)} · ${inv.party_name}`}
      />

      <div className="flex items-center gap-3">
        {isPaid ? (
          <span className="badge badge-pos">Paid</span>
        ) : (
          <span className="badge badge-warn">Due {formatINR(inv.outstanding, false)}</span>
        )}
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Unit</th>
                <th className="r">Qty</th>
                <th className="r">Rate (₹)</th>
                <th className="r">GST %</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={l.line_id}>
                  <td className="num text-muted">{i + 1}</td>
                  <td>{l.item_name}</td>
                  <td className="text-muted">{l.unit}</td>
                  <td className="r num">{Number(l.qty)}</td>
                  <td className="r num">{formatINR(l.rate, false)}</td>
                  <td className="r num text-muted">{Number(l.gst_rate) > 0 ? `${l.gst_rate}%` : '—'}</td>
                  <td className="r num">{formatINR(l.amount, false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="r text-sm text-muted">Subtotal</td>
                <td className="r num text-sm">{formatINR(subtotal, false)}</td>
              </tr>
              {gst > 0 && (
                <tr>
                  <td colSpan={6} className="r text-sm text-muted">GST</td>
                  <td className="r num text-sm">{formatINR(gst, false)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={6} className="r text-sm font-semibold">Total</td>
                <td className="r num text-sm font-semibold">{formatINR(inv.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {inv.narration && (
        <p className="text-sm text-muted">Note: {inv.narration}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/sales/SaleDetailPage.tsx
git commit -m "feat(fe): SaleDetailPage — full invoice detail at /sales/:id"
```

---

## Task 6: Wire route in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import and route to `src/App.tsx`**

Add this import after line 7 (`import { SalesPage } ...`):

```tsx
import { SaleDetailPage } from '@/features/sales/SaleDetailPage'
```

Add this route inside `<Route element={<AppShell />}>`, immediately after the `/sales` route (after line 33):

```tsx
<Route path="/sales/:id" element={<SaleDetailPage />} />
```

- [ ] **Step 2: Final build verification**

```bash
npm run build 2>&1 | tail -8
```

Expected: `✓ built in Xs` — zero TypeScript errors, zero warnings.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(fe): add /sales/:id route for invoice detail"
```

---

## Task 7: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://localhost:5173` in a browser.

- [ ] **Step 2: Test the new entry form**

1. Navigate to **Sales**
2. Confirm the layout is full-width (no two-column card split)
3. Confirm the item area is a spreadsheet table (not card rows)
4. Set Payment = "On credit", pick a customer
5. Click the Product dropdown in row 1, select an item → Rate should auto-fill
6. Enter Qty = 2 → Amount column should show qty × rate
7. Click "+ Add item", add a second item
8. Click Save invoice → success message shows voucher number (e.g. `Saved · SI/25-26/0001`)
9. The new invoice appears in the Invoices table below

- [ ] **Step 3: Test the detail page**

1. Click any row in the Invoices table
2. Browser navigates to `/sales/<uuid>`
3. Confirm: Invoice No, date, party name, Paid/Due badge
4. Confirm: item table shows each item with name, qty, rate, amount
5. Confirm: footer shows subtotal, GST (if any), total
6. Click "← Back to Sales" → returns to Sales page

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -p
git commit -m "fix(fe): sales entry/detail polish"
```
