# Richer Party & Item Masters — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — pending spec review
**Feature:** Expand the Add Party and Add Item forms to Miracle-level detail, using progressive disclosure, without altering the verified accounting structure.

## Goal

Bring the masters up to the field richness of Indian SME software (Miracle/Tally/Vyapar) — addresses, contact, tax IDs, credit terms, opening balances, default prices — while keeping fast entry (core fields first, the rest behind "▸ More details") and **provably not breaking** existing accounting.

## Scope

- Enrich the **Add Party** and **Add Item** forms (this round is **Add only**; Edit forms are out of scope).
- Group and Alias are **safe reporting metadata** (Option B), not accounting groups — see "Non-negotiable safety" below.
- A small group-wise filter on the Parties list, and a soft credit-limit warning on Sell.

## Non-negotiable safety (why this can't break anything)

1. **Party ledger structure is untouched.** Every party ledger account stays parented directly under Sundry Debtors (`debtors`) / Sundry Creditors (`creditors`) exactly as today. Receivables, payables, and the balance sheet — which depend on that parenting — are unaffected.
2. **`group_name` and `alias` are plain text columns** with **no uniqueness constraints** and **no effect** on the ledger account's parent or name. They drive search/filter/reporting only. (This is the deliberate "Option B" choice over a real recursive account-group hierarchy.)
3. **All schema changes are additive** `add column if not exists` with safe defaults — existing rows and queries keep working.
4. **RPC changes are backward-compatible.** New parameters are appended with defaults; the old call sites (onboarding, current forms) keep working. To avoid Postgres creating an ambiguous overload, the old function signatures are dropped and recreated with the wider signature, then re-granted.
5. **Opening balances post real, balanced vouchers** (no shortcut columns), so the books remain the single source of truth, and posting respects period locks via `post_voucher`.
6. A **full regression run** (smoke-test + test-phase2 + test-manufacture) must stay green after the changes.

## 1. Party master

### Fields

**Core (always visible):** Name (required) · Type · Mobile · GSTIN (auto-fills State from first 2 digits) · State

**▸ More details (collapsed):**
- Alias, Group
- Area, City, Pincode, Billing address line
- Shipping address (with a "same as billing" toggle)
- Email, Contact person
- PAN
- Aadhaar — optional, input masked (shown as `XXXX XXXX 1234` once entered)
- Udyam No., MSME Activity (select: Manufacturer / Trader / Service — stored as text)
- Credit limit (₹ → paise), Credit days
- Opening balance: amount (₹) + Dr/Cr + as-on date

### Schema (`alter table parties add column if not exists …`)

| Column | Type | Notes |
|---|---|---|
| `alias` | text | search label, no constraint |
| `group_name` | text | reporting group, no constraint |
| `area` | text | |
| `city` | text | |
| `pincode` | text | |
| `billing_address` | text | line 1/2 free text |
| `shipping_address` | text | full delivery block; null = same as billing |
| `email` | text | |
| `contact_person` | text | |
| `pan` | text | 10-char, not enforced |
| `aadhaar` | text | 12-digit; never written to audit_log |
| `udyam_no` | text | |
| `msme_activity` | text | Manufacturer/Trader/Service |
| `credit_limit` | bigint not null default 0 | paise |
| `credit_days` | int not null default 0 | |

### Opening balance posting

`create_party` gains optional `p_opening_amount bigint default 0`, `p_opening_type text default null` ('dr'/'cr'), `p_opening_date date default null`. When `p_opening_amount > 0`, inside the same transaction it posts an `OPENING` voucher (type 10) with two balanced lines:
- Customer who owes us (`dr`): **Dr** party ledger / **Cr** Opening Balance Equity (`opening_equity`).
- We owe supplier (`cr`): **Dr** Opening Balance Equity / **Cr** party ledger.

This reuses `post_voucher`, so it is atomic, audited, balanced, and period-lock-aware.

## 2. Item master

### Fields

**Core:** Name (required) · Type · Unit · HSN/SAC · GST rate · Low-stock level

**▸ More details:**
- Item code / SKU / barcode
- Default sale price (₹ → paise), Default purchase price (₹ → paise)
- Category, Description
- Opening stock: qty + rate (₹) + as-on date

### Schema (`alter table stock_items add column if not exists …`)

| Column | Type | Notes |
|---|---|---|
| `item_code` | text | SKU/barcode, no constraint |
| `category` | text | reporting group |
| `description` | text | |
| `sale_price` | bigint not null default 0 | paise |
| `purchase_price` | bigint not null default 0 | paise |

### Opening stock posting

`create_stock_item` gains optional `p_opening_qty numeric default 0`, `p_opening_rate bigint default 0`, `p_opening_date date default null`. When `p_opening_qty > 0`, it posts an `OPENING` voucher: **Dr** Inventory (`inventory`) for `round(qty*rate)` / **Cr** Opening Balance Equity, with an inward `p_stock` line `{stock_item_id, qty_change: qty, unit_cost: rate}` — seeding `qty_on_hand`, `avg_cost`, `value_on_hand`, the inventory ledger, and a stock movement, all consistently.

## 3. RPC changes

- **Drop & recreate** `create_party` and `create_stock_item` with appended optional params (`…existing…, p_details jsonb default '{}'::jsonb, p_opening_* …`). `p_details` carries all the new text/price fields so the signature stays manageable. Insert reads each key with `p_details->>'…'`; missing keys → null/default.
- Re-`grant execute` on the new signatures.
- No change to `post_voucher`, `sell`, `purchase`, or any other engine function.

## 4. Read models / queries

- Update `v_parties` to also expose `group_name, city, credit_limit, credit_days` (plus keep existing). The view stays `security_invoker`, balance computed exactly as today.
- Extend the `useItems` select list and the `Item` type with `item_code, category, sale_price, purchase_price, description`.
- Extend the `Party` type with the new fields the UI reads.

## 5. UI

- **Add Party / Add Item forms:** core fields, then a collapsible "▸ More details" block holding the rest. Money inputs in ₹ (`rupeesToPaise` on submit). Aadhaar masked. "Same as billing" toggle for shipping.
- **Parties list:** a Group filter dropdown (client-side filter of `v_parties` by `group_name`) and group sub-totals of outstanding balance — no new view, pure client aggregation.
- **Default prices auto-fill:** when an item is chosen in the Sell/Buy line editor (`ItemLines`), prefill the rate from `sale_price` (sell) / `purchase_price` (purchase); still editable per transaction.
- **Credit-limit soft warning:** on the Sell form, when mode = credit and a customer is selected, if `current outstanding + this sale > credit_limit` (and `credit_limit > 0`), show a non-blocking warning. Uses the party's `balance` (from `v_parties`) + `credit_limit`.

## 6. Testing

New `scripts/test-masters.mjs` (transactional, rolled back, same harness as smoke-test):
1. **Backward compat:** old-style `create_party(org,name,kind,phone,gstin,state)` still works; old-style `create_stock_item(...)` still works.
2. **Full party:** create with all `p_details` fields → row has them; balance unaffected when no opening.
3. **Party opening (dr):** opening 10,000 Dr → party ledger Dr 10,000, OBE Cr 10,000; **trial balance balances**.
4. **Party opening (cr):** opening 8,000 Cr → party ledger Cr, OBE Dr; trial balance balances.
5. **Item opening stock:** qty 100 @ ₹50 → `qty_on_hand=100`, `avg_cost=5000`, `value_on_hand=500000`; inventory ledger == stock value (**reconciliation exact**); trial balance balances.
6. **Aadhaar not in audit:** create with aadhaar → `audit_log.detail` for the party does not contain the aadhaar value.

Then the **regression suite** (smoke-test, test-phase2, test-manufacture) must stay green, plus `npx tsc --noEmit` and `npm run build`.

## Out of scope (future)

- Edit forms for party/item.
- Real recursive account-group hierarchy (Option A).
- Alternate unit + conversion (the separate UOM feature), cess, multi-GSTIN, bank details on invoice print.

## Definition of done

- Migration applies cleanly on the cloud project; old call sites unaffected.
- All new tests pass; full regression green; tsc + build clean.
- Forms work one-handed at 360px (core fields first, More expands); money round-trips paise↔rupee.
- Receivables/payables/balance sheet totals unchanged for existing data.
