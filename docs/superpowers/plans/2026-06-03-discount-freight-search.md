# Discount + Freight + Round-off + Product Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trade discount, freight charge, and auto round-off to the Sales form + RPC; replace the plain item select with a searchable combobox.

**Architecture:** One DB migration alters `invoices`, updates the `sell` RPC (new discount/freight params, proportional GST scaling, auto round-off), and refreshes `v_invoice_detail`. Frontend gets a new `ItemCombobox` component, updated `ItemTable`, updated `SalesPage` (discount/freight inputs + bill breakdown), updated `SaleDetailPage` and `InvoicePrint` (show the new totals rows), updated `rpc.sell()` and `InvoiceDetail` type.

**Tech Stack:** Supabase Postgres, React + TypeScript, Tailwind v4, lucide-react.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/0013_discount_freight.sql` | Alter invoices, updated sell RPC, refresh view |
| Modify | `src/lib/rpc.ts` | Add discount + freight params to rpc.sell() |
| Modify | `src/hooks/queries.ts` | Add 3 fields to InvoiceDetail |
| Create | `src/components/ItemCombobox.tsx` | Searchable product picker |
| Modify | `src/components/ItemTable.tsx` | Use ItemCombobox instead of select |
| Modify | `src/features/sales/SalesPage.tsx` | Discount/freight inputs + bill breakdown |
| Modify | `src/features/sales/SaleDetailPage.tsx` | Show discount/freight/roundoff in totals |
| Modify | `src/features/sales/InvoicePrint.tsx` | Show same in print totals |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/0013_discount_freight.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0013_discount_freight.sql`:

```sql
-- =============================================================
-- Discount, freight, and round-off on sales invoices.
-- =============================================================

-- ---------- Alter invoices ----------
alter table invoices add column if not exists discount_amount bigint not null default 0;
alter table invoices add column if not exists freight_amount  bigint not null default 0;
alter table invoices add column if not exists round_off       bigint not null default 0;

-- ---------- Updated sell (adds discount, freight, round-off) ----------
create or replace function sell(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_mode text default 'credit', p_narration text default null,
  p_discount bigint default 0, p_freight bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb; v_item stock_items%rowtype;
  v_qty numeric(18,4); v_rate bigint; v_line_base bigint; v_gst bigint;
  v_base bigint := 0; v_cogs bigint := 0;
  v_cgst bigint := 0; v_sgst bigint := 0; v_igst bigint := 0;
  v_taxable bigint; v_gross bigint; v_round_off bigint; v_bill bigint;
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

  -- Pass 1: compute base amounts and GST on full (pre-discount) base
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

  -- Scale GST proportionally for trade discount
  if p_discount > 0 and v_base > 0 then
    v_cgst := round(v_cgst::numeric * (v_base - p_discount) / v_base);
    v_sgst := round(v_sgst::numeric * (v_base - p_discount) / v_base);
    v_igst := round(v_igst::numeric * (v_base - p_discount) / v_base);
  end if;

  v_taxable   := v_base - p_discount;
  v_gross     := v_taxable + v_cgst + v_sgst + v_igst + p_freight;
  v_bill      := round(v_gross::numeric / 100) * 100;  -- round to nearest rupee
  v_round_off := v_bill - v_gross;                     -- + collected more, - collected less

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_debit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_debit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  -- Debit debtor/cash for bill amount; credit sales for taxable+freight
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_debit_acct, 'party_id', v_party_line, 'debit', v_bill, 'credit', 0),
    jsonb_build_object('account_id', sys_account(p_org,'sales'), 'debit', 0, 'credit', v_taxable + p_freight));
  if v_cgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_cgst'), 'debit', 0, 'credit', v_cgst)); end if;
  if v_sgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_sgst'), 'debit', 0, 'credit', v_sgst)); end if;
  if v_igst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_igst'), 'debit', 0, 'credit', v_igst)); end if;
  if v_round_off <> 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', sys_account(p_org,'roundoff'),
      'debit',  greatest(0, -v_round_off),
      'credit', greatest(0,  v_round_off)));
  end if;
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'cogs'),      'debit', v_cogs, 'credit', 0),
      jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', 0,      'credit', v_cogs));
  end if;

  v_res := post_voucher(p_org, 1::smallint, p_date, p_party, p_narration, v_lines, v_stock);

  if p_mode = 'credit' then
    insert into invoices (org_id, party_id, voucher_id, invoice_no, date,
                          total, outstanding, discount_amount, freight_amount, round_off)
      values (p_org, p_party, (v_res->>'voucher_id')::uuid, v_res->>'voucher_no', p_date,
              v_bill, v_bill, p_discount, p_freight, v_round_off)
      returning id into v_invoice_id;

    for it in select * from jsonb_array_elements(p_items) loop
      insert into invoice_lines (org_id, invoice_id, stock_item_id, qty, rate, amount)
      values (
        p_org, v_invoice_id,
        (it->>'stock_item_id')::uuid,
        (it->>'qty')::numeric,
        (it->>'rate')::bigint,
        round((it->>'qty')::numeric * (it->>'rate')::bigint)::bigint
      );
    end loop;
  end if;

  return v_res;
end; $$;

-- ---------- Refresh v_invoice_detail with new columns ----------
drop view if exists v_invoice_detail;
create view v_invoice_detail with (security_invoker = on) as
select
  i.org_id,
  i.id            as invoice_id,
  i.invoice_no,
  i.date,
  i.total,
  i.outstanding,
  i.discount_amount,
  i.freight_amount,
  i.round_off,
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
grant execute on function sell(uuid, date, uuid, jsonb, text, text, bigint, bigint) to authenticated;
```

- [ ] **Step 2: Apply the migration**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | sed 's/^DATABASE_URL=//')"
node scripts/run-migrations.mjs 0013
```

Expected: `Applying 0013_discount_freight.sql … ok`

- [ ] **Step 3: Verify**

```bash
node -e "
import('pg').then(({default:pg})=>{
  const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  c.connect()
    .then(()=>c.query(\"select column_name from information_schema.columns where table_name='invoices' and column_name in ('discount_amount','freight_amount','round_off')\"))
    .then(r=>{console.log('New invoice cols:',r.rows.map(x=>x.column_name));c.end()});
})
"
```

Expected: 3 column names printed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_discount_freight.sql
git commit -m "feat(db): discount/freight/round-off on sell RPC + invoices table"
```

---

## Task 2: Update rpc.ts + InvoiceDetail type

**Files:**
- Modify: `src/lib/rpc.ts`
- Modify: `src/hooks/queries.ts`

- [ ] **Step 1: Update `rpc.sell()` in `src/lib/rpc.ts`**

Find the current `sell` entry in the `rpc` object:
```ts
sell: (orgId: string, date: string, party: string | null, items: unknown[], mode: string, narration?: string) =>
  callRpc<{ voucher_no: string }>('sell', {
    p_org: orgId, p_date: date, p_party: party, p_items: items, p_mode: mode, p_narration: narration ?? null,
  }),
```

Replace with:
```ts
sell: (orgId: string, date: string, party: string | null, items: unknown[], mode: string, narration?: string, discount = 0, freight = 0) =>
  callRpc<{ voucher_no: string }>('sell', {
    p_org: orgId, p_date: date, p_party: party, p_items: items, p_mode: mode,
    p_narration: narration ?? null, p_discount: discount, p_freight: freight,
  }),
```

- [ ] **Step 2: Add 3 fields to `InvoiceDetail` type in `src/hooks/queries.ts`**

Find `InvoiceDetail` type. Add after `narration: string | null`:
```ts
discount_amount: number
freight_amount: number
round_off: number
```

In the `useInvoiceDetail` queryFn, after `narration: first.narration as string | null,` add:
```ts
discount_amount: Number(first.discount_amount),
freight_amount:  Number(first.freight_amount),
round_off:       Number(first.round_off),
```

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 4: Commit**

```bash
git add src/lib/rpc.ts src/hooks/queries.ts
git commit -m "feat(fe): add discount/freight/round-off to rpc.sell + InvoiceDetail type"
```

---

## Task 3: ItemCombobox component

**Files:**
- Create: `src/components/ItemCombobox.tsx`

- [ ] **Step 1: Create `src/components/ItemCombobox.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Item } from '@/hooks/queries'

export function ItemCombobox({
  items,
  value,
  onChange,
}: {
  items: Item[]
  value: string
  onChange: (id: string, item: Item | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = items.find((i) => i.id === value) ?? null

  const filtered = query
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
    : items

  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlighted(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (item: Item) => {
    onChange(item.id, item)
    setOpen(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { setHighlighted((h) => Math.min(h + 1, filtered.length - 1)); e.preventDefault(); return }
    if (e.key === 'ArrowUp')   { setHighlighted((h) => Math.max(h - 1, 0)); e.preventDefault(); return }
    if (e.key === 'Enter' && filtered[highlighted]) { select(filtered[highlighted]); e.preventDefault() }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {open ? (
        <input
          ref={inputRef}
          className="w-full bg-transparent text-sm outline-none border-b border-brand-400 pb-0.5"
          placeholder="Search…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHighlighted(0) }}
          onKeyDown={handleKey}
        />
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm"
          onClick={() => setOpen(true)}
        >
          <span className={selected ? 'text-ink' : 'text-muted'}>
            {selected ? selected.name : 'Select item…'}
          </span>
          <ChevronDown size={14} className="text-muted shrink-0" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-line bg-white shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No items found</p>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-paper ${i === highlighted ? 'bg-paper' : ''}`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => select(item)}
              >
                <span>{item.name}</span>
                <span className="text-xs text-muted ml-2 shrink-0">{item.unit}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 3: Commit**

```bash
git add src/components/ItemCombobox.tsx
git commit -m "feat(fe): ItemCombobox — searchable product picker"
```

---

## Task 4: Update ItemTable to use ItemCombobox

**Files:**
- Modify: `src/components/ItemTable.tsx`

- [ ] **Step 1: Replace `<select>` with `<ItemCombobox>` in `src/components/ItemTable.tsx`**

Add import at top of file:
```tsx
import { ItemCombobox } from './ItemCombobox'
```

In the `<td>` that contains the `<select>`, replace the entire `<select>` block with:
```tsx
<ItemCombobox
  items={items}
  value={l.stock_item_id}
  onChange={(id, item) => {
    const prefill = !l.rate && item?.sale_price ? String(item.sale_price / 100) : l.rate
    set(i, { stock_item_id: id, rate: prefill || '' })
  }}
/>
```

Remove the old `<select>` and its `onChange` handler entirely.

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 3: Commit**

```bash
git add src/components/ItemTable.tsx
git commit -m "feat(fe): use ItemCombobox in ItemTable for product search"
```

---

## Task 5: Update SalesPage with discount/freight inputs + bill breakdown

**Files:**
- Modify: `src/features/sales/SalesPage.tsx`

- [ ] **Step 1: Add state variables**

After the existing `const [narration, setNarration] = useState('')` line, add:
```tsx
const [discount, setDiscount] = useState('')
const [freight, setFreight] = useState('')
```

- [ ] **Step 2: Add bill amount calculation**

After the existing `overLimit` calculation, add:
```tsx
const discountPaise = rupeesToPaise(discount || '0')
const freightPaise  = rupeesToPaise(freight  || '0')
const gstPaise = lines.reduce((s, l) => {
  const it = items.find((x) => x.id === l.stock_item_id)
  const base = Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0'))
  return s + (it ? Math.round(base * Number(it.gst_rate) / 100) : 0)
}, 0)
const taxablePaise  = Math.max(0, linesTotalPaise - discountPaise)
const scaledGst     = linesTotalPaise > 0 ? Math.round(gstPaise * taxablePaise / linesTotalPaise) : 0
const grossPaise    = taxablePaise + scaledGst + freightPaise
const billPaise     = Math.round(grossPaise / 100) * 100
const roundOffPaise = billPaise - grossPaise
```

- [ ] **Step 3: Update the submit handler**

In the `submit` function, update the `rpc.sell()` call to pass discount and freight:
```tsx
const res = await rpc.sell(
  currentOrgId, date, mode === 'credit' ? party : null,
  payload, mode, narration, discountPaise, freightPaise
)
```

Also reset discount and freight on success:
```tsx
setLines([emptyLine()]); setNarration(''); setDiscount(''); setFreight('')
```

- [ ] **Step 4: Add discount/freight inputs below ItemTable**

After `<ItemTable items={items} value={lines} onChange={setLines} />`, add:
```tsx
<div className="grid grid-cols-2 gap-3">
  <Field label="Discount (₹)">
    <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
  </Field>
  <Field label="Freight (₹)">
    <Input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" />
  </Field>
</div>
```

- [ ] **Step 5: Add bill breakdown below discount/freight**

After the discount/freight grid, add:
```tsx
<div className="space-y-1 text-sm border-t border-line pt-3">
  {discountPaise > 0 && (
    <div className="flex justify-between text-muted">
      <span>Subtotal</span><span className="num">{formatINR(linesTotalPaise, false)}</span>
    </div>
  )}
  {discountPaise > 0 && (
    <div className="flex justify-between text-muted">
      <span>− Discount</span><span className="num">{formatINR(discountPaise, false)}</span>
    </div>
  )}
  {discountPaise > 0 && (
    <div className="flex justify-between text-muted">
      <span>Taxable</span><span className="num">{formatINR(taxablePaise, false)}</span>
    </div>
  )}
  {scaledGst > 0 && (
    <div className="flex justify-between text-muted">
      <span>GST</span><span className="num">{formatINR(scaledGst, false)}</span>
    </div>
  )}
  {freightPaise > 0 && (
    <div className="flex justify-between text-muted">
      <span>+ Freight</span><span className="num">{formatINR(freightPaise, false)}</span>
    </div>
  )}
  {roundOffPaise !== 0 && (
    <div className="flex justify-between text-muted">
      <span>Round-off</span>
      <span className="num">{roundOffPaise > 0 ? '+' : '−'}{formatINR(Math.abs(roundOffPaise), false)}</span>
    </div>
  )}
  <div className="flex justify-between font-semibold border-t border-line pt-1">
    <span>Bill Amount</span><span className="num">{formatINR(billPaise)}</span>
  </div>
</div>
```

- [ ] **Step 6: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 7: Commit**

```bash
git add src/features/sales/SalesPage.tsx
git commit -m "feat(fe): discount/freight inputs + live bill breakdown on SalesPage"
```

---

## Task 6: Update SaleDetailPage + InvoicePrint

**Files:**
- Modify: `src/features/sales/SaleDetailPage.tsx`
- Modify: `src/features/sales/InvoicePrint.tsx`

- [ ] **Step 1: Update `SaleDetailPage.tsx` tfoot**

In `SaleDetailPage.tsx`, find the `<tfoot>` section. Currently:
```tsx
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
```

Replace with:
```tsx
<tfoot>
  <tr>
    <td colSpan={6} className="r text-sm text-muted">Subtotal</td>
    <td className="r num text-sm">{formatINR(subtotal, false)}</td>
  </tr>
  {inv.discount_amount > 0 && (
    <tr>
      <td colSpan={6} className="r text-sm text-muted">− Discount</td>
      <td className="r num text-sm">{formatINR(inv.discount_amount, false)}</td>
    </tr>
  )}
  {gst > 0 && (
    <tr>
      <td colSpan={6} className="r text-sm text-muted">GST</td>
      <td className="r num text-sm">{formatINR(gst, false)}</td>
    </tr>
  )}
  {inv.freight_amount > 0 && (
    <tr>
      <td colSpan={6} className="r text-sm text-muted">+ Freight</td>
      <td className="r num text-sm">{formatINR(inv.freight_amount, false)}</td>
    </tr>
  )}
  {inv.round_off !== 0 && (
    <tr>
      <td colSpan={6} className="r text-sm text-muted">Round-off</td>
      <td className="r num text-sm">
        {inv.round_off > 0 ? '+' : '−'}{formatINR(Math.abs(inv.round_off), false)}
      </td>
    </tr>
  )}
  <tr>
    <td colSpan={6} className="r text-sm font-semibold">Bill Amount</td>
    <td className="r num text-sm font-semibold">{formatINR(inv.total)}</td>
  </tr>
</tfoot>
```

Note: `gst` is already computed as `inv.total - subtotal` at the top of the component — keep that unchanged. With discount/freight/roundoff, the total GST shown in the `gst` variable may be slightly off (since `inv.total` now includes freight and round-off). Update the `gst` computation:

```tsx
const subtotal    = inv.lines.reduce((s, l) => s + l.amount, 0)
const taxable     = subtotal - inv.discount_amount
const gst         = inv.total - taxable - inv.freight_amount - inv.round_off
const isPaid      = inv.outstanding === 0
```

- [ ] **Step 2: Update `InvoicePrint.tsx` totals table**

In `InvoicePrint.tsx`, find the totals `<table>`. The current `subtotal` is `inv.lines.reduce(...)`. Update:

```tsx
const subtotal    = inv.lines.reduce((s, l) => s + l.amount, 0)
const taxable     = subtotal - inv.discount_amount
const totalGst    = inv.total - taxable - inv.freight_amount - inv.round_off
```

Then in the totals table body, after the `<tr>` for Subtotal, add:
```tsx
{inv.discount_amount > 0 && (
  <tr>
    <td className="pr-8 py-1">− Discount</td>
    <td className="text-right font-mono">{formatINR(inv.discount_amount, false)}</td>
  </tr>
)}
{inv.discount_amount > 0 && (
  <tr>
    <td className="pr-8 py-1">Taxable</td>
    <td className="text-right font-mono">{formatINR(taxable, false)}</td>
  </tr>
)}
```

And after the GST rows (CGST/SGST/IGST/GST), add:
```tsx
{inv.freight_amount > 0 && (
  <tr>
    <td className="pr-8 py-1">+ Freight</td>
    <td className="text-right font-mono">{formatINR(inv.freight_amount, false)}</td>
  </tr>
)}
{inv.round_off !== 0 && (
  <tr>
    <td className="pr-8 py-1">Round-off</td>
    <td className="text-right font-mono">
      {inv.round_off > 0 ? '+' : '−'}{formatINR(Math.abs(inv.round_off), false)}
    </td>
  </tr>
)}
```

Also rename "Total" row label to "Bill Amount" in the last `<tr>`.

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 4: Commit**

```bash
git add src/features/sales/SaleDetailPage.tsx src/features/sales/InvoicePrint.tsx
git commit -m "feat(fe): show discount/freight/round-off in detail page and print"
```
