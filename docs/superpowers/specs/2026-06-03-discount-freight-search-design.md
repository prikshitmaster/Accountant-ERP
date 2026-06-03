# Discount + Freight + Round-off + Product Search Design

**Date:** 2026-06-03  
**Status:** Approved — ready for implementation

---

## Problem

The Sales entry form lacks three features every Indian SME uses daily:
1. **Trade discount** — almost every B2B deal has a discount
2. **Freight/packing charges** — common addition on delivery invoices
3. **Round-off** — standard Indian practice (round bill to nearest ₹)
4. **Product search** — plain `<select>` is unusable with many items

---

## Bill Total Formula

```
Item Subtotal          (sum of qty × rate per line)
− Discount (flat ₹)   pre-tax; reduces taxable value; GST scaled proportionally
= Taxable Amount
+ GST                  CGST+SGST (intra) or IGST (inter), on taxable amount
+ Freight (flat ₹)    post-tax; bundled into Sales credit for simplicity
= Gross Total
± Round-off            auto: round to nearest ₹1; posted to Round-off account
= Bill Amount          what the debtor owes
```

**Discount reduces GST:** GST is scaled by `(base − discount) / base` across all items — the standard proportional treatment for a bill-level trade discount in Indian accounting.

**Freight → Sales:** Freight is credited to the Sales account (bundled). No separate Freight Income account needed for MVP.

**Round-off accounting:** The `roundoff` system account already exists. If round_off > 0 (collected more), Cr Round-off. If < 0 (collected less), Dr Round-off.

---

## Scope

### In scope
- DB migration `0013`: alter `invoices` table + update `sell` RPC + update `v_invoice_detail` view
- `src/lib/rpc.ts`: add `discount` and `freight` params to `rpc.sell()`
- `src/hooks/queries.ts`: add `discount_amount`, `freight_amount`, `round_off` to `InvoiceDetail`
- `src/components/ItemCombobox.tsx`: new searchable product picker component
- `src/components/ItemTable.tsx`: replace `<select>` with `<ItemCombobox>`
- `src/features/sales/SalesPage.tsx`: add Discount + Freight inputs; show live Bill Amount
- `src/features/sales/SaleDetailPage.tsx`: show discount/freight/round-off in totals
- `src/features/sales/InvoicePrint.tsx`: show same in print totals

### Out of scope
- Per-line discount
- Freight with its own GST rate
- Cash discount (post-payment)
- Purchase page changes

---

## DB Changes (`0013_discount_freight.sql`)

### Alter `invoices` table
```sql
alter table invoices add column if not exists discount_amount bigint not null default 0;
alter table invoices add column if not exists freight_amount  bigint not null default 0;
alter table invoices add column if not exists round_off       bigint not null default 0;
```

### Updated `sell` RPC
New parameters: `p_discount bigint default 0`, `p_freight bigint default 0`

New declare vars: `v_taxable bigint`, `v_gross bigint`, `v_round_off bigint`, `v_bill bigint`

After the item loop (v_base, v_cgst, v_sgst, v_igst computed on full base):

```sql
-- Scale GST proportionally for discount
if p_discount > 0 and v_base > 0 then
  v_cgst := round(v_cgst::numeric * (v_base - p_discount) / v_base);
  v_sgst := round(v_sgst::numeric * (v_base - p_discount) / v_base);
  v_igst := round(v_igst::numeric * (v_base - p_discount) / v_base);
end if;

v_taxable   := v_base - p_discount;
v_gross     := v_taxable + v_cgst + v_sgst + v_igst + p_freight;
v_bill      := round(v_gross::numeric / 100) * 100;  -- round to nearest ₹
v_round_off := v_bill - v_gross;                     -- + = collected more, - = collected less
```

Ledger entries change:
- Debit debtor/cash: `v_bill` (not old `v_total`)
- Credit sales: `v_taxable + p_freight` (net of discount, inclusive of freight)
- Credit output GST accounts: unchanged (now scaled)
- Round-off entry (only if non-zero):
  ```sql
  jsonb_build_object('account_id', sys_account(p_org,'roundoff'),
    'debit',  greatest(0, -v_round_off),
    'credit', greatest(0,  v_round_off))
  ```
- COGS entry: unchanged

Invoice insert gains three new columns:
```sql
insert into invoices (..., discount_amount, freight_amount, round_off)
values (..., p_discount, p_freight, v_round_off)
```

### Updated `v_invoice_detail` view
Add three columns:
```sql
i.discount_amount,
i.freight_amount,
i.round_off
```

---

## Frontend

### New: `src/components/ItemCombobox.tsx`

Searchable product picker. Replaces `<select>` in `ItemTable`.

**Props:**
```ts
type ItemComboboxProps = {
  items: Item[]
  value: string        // selected stock_item_id ('' = none)
  onChange: (id: string, item: Item | null) => void
}
```

**Behaviour:**
- Closed state: shows selected item name (or "Select item…" placeholder) + chevron icon
- Click → opens: replaces text with a filter input, shows scrollable dropdown of matching items
- Filter: case-insensitive substring match on item name
- Each dropdown row: `{name}` + `{unit}` right-aligned in muted text
- Keyboard: Escape closes, ArrowUp/ArrowDown navigate, Enter selects highlighted item
- Click outside → closes (uses `useEffect` with `mousedown` listener)
- No external library

### Modified: `src/components/ItemTable.tsx`

Replace the `<select>` in each row with `<ItemCombobox>`. The `onChange` handler gets `(id, item)` — use `item` to auto-fill rate if field is empty.

### Modified: `src/features/sales/SalesPage.tsx`

Below `<ItemTable>`, add a two-column grid with Discount and Freight inputs:
```
[Discount (₹)]  [Freight (₹)]
```

The running total footer in ItemTable currently shows Subtotal + GST + Total.  
Replace the "Total" line with the full bill breakdown computed in `SalesPage` (not in `ItemTable`):

```
Subtotal:     ₹X,XXX
− Discount:   −₹X          (only shown if > 0)
= Taxable:    ₹X,XXX       (only shown if discount > 0)
+ GST:        ₹XXX
+ Freight:    ₹XXX         (only shown if > 0)
  Round-off:  ±₹X.XX       (only shown if non-zero)
Bill Amount:  ₹X,XXX       (bold)
```

This breakdown lives in `SalesPage` below the `ItemTable` and inputs, not inside `ItemTable` itself. `ItemTable` footer keeps showing only Subtotal + GST + Total (the pre-discount, pre-freight total). `SalesPage` adds the extra rows below.

`rpc.sell()` call gains two new args: `rupeesToPaise(discount)` and `rupeesToPaise(freight)`.

### Modified: `src/features/sales/SaleDetailPage.tsx`

In the `<tfoot>`, add rows after Subtotal:
- Discount row (if `inv.discount_amount > 0`)
- Freight row (if `inv.freight_amount > 0`)
- Round-off row (if `inv.round_off !== 0`)

### Modified: `src/features/sales/InvoicePrint.tsx`

Same addition in the totals table:
- `− Discount` row (if > 0)
- `+ Freight` row (if > 0)
- `± Round-off` row (if non-zero)

### Modified: `src/hooks/queries.ts`

Add to `InvoiceDetail` type:
```ts
discount_amount: number
freight_amount: number
round_off: number
```

Map in `queryFn`:
```ts
discount_amount: Number(first.discount_amount),
freight_amount:  Number(first.freight_amount),
round_off:       Number(first.round_off),
```

### Modified: `src/lib/rpc.ts`

Update `rpc.sell()`:
```ts
sell: (orgId, date, party, items, mode, narration, discount = 0, freight = 0) =>
  callRpc<{ voucher_no: string }>('sell', {
    p_org: orgId, p_date: date, p_party: party, p_items: items,
    p_mode: mode, p_narration: narration ?? null,
    p_discount: discount, p_freight: freight,
  }),
```

---

## What Does NOT Change

- Purchase page — untouched
- Manufacture page — untouched
- `invoice_lines` table — untouched (discount is invoice-level, not per-line)
- All other RPCs — untouched
- Cash/bank sale flow — still works (discount/freight default to 0)
