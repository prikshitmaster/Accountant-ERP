# Manufacture (BOM RM→FG) — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — pending spec review
**Feature:** Ad-hoc manufacture voucher that consumes raw materials and produces finished goods, keeping inventory and the general ledger in exact sync.

## Goal

Let a user record a production run: consume raw materials/components and produce one or more finished goods. The finished-good cost is the rolled-up value of the materials consumed (moving weighted average). The general ledger and perpetual inventory must stay in exact agreement (acceptance invariant: *Inventory ledger balance = Σ `stock_items.value_on_hand`, to the paise*).

## Scope (decisions)

- **Ad-hoc, no stored BOM.** Inputs and outputs are entered per run. Reusable recipes are explicitly out of scope for v1 and can be added later as a purely additive layer (two tables + a "load recipe" action) with no change to the engine.
- **Material-only cost.** Finished-good value = value of materials consumed. No labour/overhead capitalisation in v1; labour is booked separately via the existing `expense` RPC.
- **Cost-weight allocation across outputs.** When a run yields multiple finished goods (co-products), the user supplies a relative cost `weight` per output; total material value is allocated by weight.

## Non-goals (v1)

- Stored/reusable BOM recipes.
- Labour/overhead capitalisation into finished-good cost.
- UOM conversion between input and output units.
- Scrap/by-product valuation rules beyond the weight split.

## Architecture

`manufacture` is a new `SECURITY DEFINER` RPC wrapper, a sibling of `sell`/`purchase`, that calls the existing `post_voucher` with voucher type `STOCK_JOURNAL` (id 9). It does **not** introduce a new posting path — all atomicity, FY-aware numbering, period-lock checks, balance checks, audit logging, and stock-movement valuation come from `post_voucher` unchanged.

### The one engine change (additive, guarded)

`post_voucher`'s inward stock branch currently computes value as `round(qty × unit_cost)`. Add an optional explicit override:

```sql
v_value_change := coalesce((st->>'value_change')::bigint, round(v_qty * v_unit_cost));
```

- **Backward compatible:** existing callers (`sell`, `purchase`) never pass `value_change`, so their behaviour is unchanged.
- **Why needed:** with fractional quantities and integer-paise unit costs, allocating a total across multiple outputs cannot land on the exact total via per-unit rounding. The override lets `manufacture` pass each output its exact allocated value, so the books reconcile to the paise and the voucher stays balanced.
- For the `stock_movements` record, when `value_change` is supplied, `unit_cost` is recorded as `round(value_change / qty)` for display; `value_change` remains authoritative for `value_on_hand`/`avg_cost`.

## The `manufacture` RPC

```
manufacture(
  p_org uuid, p_date date,
  p_inputs  jsonb,   -- [{stock_item_id, qty}]            consumed (qty > 0)
  p_outputs jsonb,   -- [{stock_item_id, qty, weight}]    produced (qty > 0, weight > 0)
  p_narration text default null
) returns jsonb      -- {voucher_id, voucher_no}
```

**Steps (inside the single `post_voucher` transaction):**

1. **Auth:** `org_role(p_org)` must be non-null (any role may manufacture, consistent with `sell`/`purchase`). Raise `not_member` otherwise.
2. **Validate:** `p_inputs` and `p_outputs` each non-empty; every `qty > 0`; every output `weight > 0`. Raise `empty_voucher` / `invalid_quantity` / `invalid_weight`.
3. **Inputs:** for each input, look up `stock_items` (`unknown_stock_item` if missing); per-item out-value = `round(qty × avg_cost)` (matching `post_voucher`'s own per-line rounding); accumulate `total_rm_value`. Build outward stock lines `{stock_item_id, qty_change: -qty, reason: 'Manufacture: consume'}`.
4. **Zero-cost guard:** if `total_rm_value = 0`, raise `zero_cost_manufacture`.
5. **Outputs — allocate by weight:** `total_weight = Σ weight`. For each output except the last, `allocᵢ = round(total_rm_value × weightᵢ / total_weight)`, accumulating `running`. The **last output** gets `total_rm_value − running` (absorbs rounding remainder → exact conservation). Build inward stock lines `{stock_item_id, qty_change: qty, value_change: allocᵢ, reason: 'Manufacture: produce'}`.
6. **Ledger lines:** `Dr Inventory total_rm_value` and `Cr Inventory total_rm_value` (both the system `inventory` account via `sys_account(p_org,'inventory')`). Same account → net-zero change to total inventory value; value shifts from input items to output items. Balanced and non-zero.
7. Call `post_voucher(p_org, 9::smallint, p_date, null, p_narration, v_lines, v_stock)` and return its result.
8. `grant execute` to `authenticated`.

### Invariants preserved

- **Balanced voucher:** Dr = Cr = `total_rm_value`.
- **Inventory ↔ GL exact:** Σ inward `value_change` = `total_rm_value` (remainder trick) = Cr Inventory; outward values = Dr-side consumption; net inventory value unchanged.
- **Atomic & audited:** entirely within `post_voucher`.

## Error codes

`not_member`, `empty_voucher`, `invalid_quantity`, `invalid_weight`, `unknown_stock_item`, `zero_cost_manufacture`, plus inherited `period_locked` / `negative_stock_blocked` from `post_voucher`.

## Cancellation

Reuses the existing `cancel_voucher`, which replays `stock_movements` to reverse. **Must verify** it restores a STOCK_JOURNAL's produced/consumed values exactly; if reversal of the inward leg recomputes at current `avg_cost` and drifts, extend the reversal path to pass `value_change` so the original values are restored. (Tracked as a verification step in the plan.)

## Frontend

- `src/lib/rpc.ts`: typed `manufacture()` wrapper; map `zero_cost_manufacture` and the validation errors to friendly toasts.
- `src/features/stock/`: a **Manufacture** sheet launched from StockPage.
  - Input rows: item picker + qty (+ live "cost" = qty × avg_cost shown read-only).
  - Output rows: item picker + qty + cost-weight; live preview of each output's allocated value and per-unit cost, and the run total.
  - Date, narration. Sticky Save. Success toast shows the voucher number.
- The resulting Stock Journal appears automatically in Day Book (`v_day_book`) and Stock Ledger (`v_stock_ledger`) via the movements/ledger entries — no extra read wiring.

## Testing

Real authenticated supabase-js client (per project convention; helpers in `scripts/`), transactional/rolled-back where possible:

1. **Single output:** 4 legs (avg ₹50) + 1 top (avg ₹200) → 1 table. Table value = ₹400; legs −4, top −1, table +1; Inventory ledger net change 0; **trial balance balanced**; **reconciliation exact**.
2. **Co-products:** one run → two outputs with weights 70/30; allocated values sum exactly to total material value (to the paise); both per-unit costs correct.
3. **Zero-cost guard:** inputs with avg_cost 0 → `zero_cost_manufacture`.
4. **Negative stock:** consuming more than on-hand respects `negative_stock_policy` (`block` raises).
5. **Period lock:** manufacture into a locked period → `period_locked`.
6. **Cancel:** cancel a manufacture → stock and ledger restored; originals intact.
7. **Regression:** re-run the existing sell/purchase acceptance checks to prove the `post_voucher` `value_change` change altered nothing for existing callers.

## Definition of done

- Migration applies cleanly; `manufacture` + `value_change` change live on the cloud project.
- All tests above pass, including the regression run.
- Manufacture sheet works at 360px and desktop; money round-trips paise↔rupee.
- No floats touch money; reconciliation holds to the paise.
