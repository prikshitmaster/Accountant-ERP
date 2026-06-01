# Accounting & Stock Software — Final Implementation Spec (v3, build-ready)

**Stack:** React (Vite + TypeScript) + Supabase (Postgres, Auth, RLS, RPC)
**Market:** Indian SMEs — traders, manufacturers, service businesses
**This document is the single source of truth for coding.** It folds the v2 architecture into a build-ready spec and adds the frontend, UX, and mobile-first layers that v2 left open. No code is written here; section 14 gives the exact build order.

---

## 0. Non-negotiable principles (the invariants the whole system protects)

These are correctness invariants. Every feature must preserve them. They are also the acceptance tests (§13).

1. **Tenant = organization, never user.** All rows carry `org_id`. Users join orgs via `memberships`. RLS keys on org membership.
2. **One general ledger; inventory is a ledger account.** Stock movement and GL posting happen in the *same* DB transaction. They cannot drift.
3. **Perpetual inventory, Moving Weighted Average.** Closing stock value is always known and always equals the Inventory ledger balance.
4. **Purchases capitalise to inventory; COGS is recognised on sale.** Never expense raw material on purchase.
5. **Vouchers have N balanced lines** (Σdebit = Σcredit), not exactly two.
6. **Posting is atomic, server-side, in Postgres** via `SECURITY DEFINER` RPC functions. All-or-nothing.
7. **Posted vouchers are immutable.** Corrections are reversals. Periods can be locked.
8. **Money = bigint paise. Quantity = numeric(18,4). Rates = bigint paise.** No floats for money, ever.

> If a UI convenience would violate any of these, the UI loses.

---

## 1. The six product pillars (how the requirements map to the build)

| Pillar | What it means concretely | Where enforced |
|---|---|---|
| **Simple UI** | Task-first screens (Sell, Buy, Receive, Pay), one primary action per screen, plain-language labels (no "debit/credit" for staff), smart defaults, ≤ 4 fields before the user can save. | §8 UX rules, §9 screens |
| **Accurate accounting** | Double-entry, balanced vouchers, immutable posts, reversals, period locks, snapshots. | §4 schema, §6 RPC |
| **Inventory ↔ accounting sync** | Stock movement + COGS + inventory ledger line all inside one RPC transaction; reconciliation report asserts equality. | §6.2 `sell`/`purchase`, §11 reconciliation |
| **Audit trail intact** | Append-only `audit_log`, append-only `stock_movements`, never-deleted vouchers, `reverses_id` chain. | §4.7, §6.3 |
| **Mobile-first** | Designed at 360px first, thumb-reachable primary actions, bottom nav, single-column forms, large tap targets, offline-tolerant reads. | §8 design system |
| **React + Supabase** | Reads via PostgREST on RLS-guarded views; writes only via `supabase.rpc(...)`. No client-side ledger writes. | §7 API contract |

---

## 2. System architecture (one diagram in words)

```
React SPA (Vite + TS)
  ├─ Auth: Supabase Auth (email/OTP + password)
  ├─ Reads:  supabase.from('v_*').select()      → PostgREST on VIEWS, guarded by RLS
  └─ Writes: supabase.rpc('sell' | 'purchase'…) → SECURITY DEFINER Postgres functions
                                                     │
Supabase Postgres ─────────────────────────────────┘
  ├─ Tables (org-scoped, RLS on every table)
  ├─ RPC functions = the accounting engine (atomic, validated, audited)
  ├─ Views = report read models (snapshot + delta)
  └─ Triggers: keep denormalised heads consistent; block direct writes to ledger from client role
```

**Hard rule:** the frontend has *zero* write access to `ledger_entries`, `stock_movements`, `vouchers`, `invoices`, `bills`. These are revoked from the `authenticated` role for INSERT/UPDATE/DELETE. The only write path is RPC.

---

## 3. Tech choices (locked)

| Concern | Choice | Notes |
|---|---|---|
| Build tool | Vite + React 18 + TypeScript | fast, simple |
| Styling | Tailwind CSS + shadcn/ui | mobile-first utilities, accessible primitives |
| Data fetching | TanStack Query | caching, retry, offline-tolerant reads |
| Forms | React Hook Form + Zod | client validation mirrors DB checks |
| Routing | React Router | |
| State | TanStack Query + React context for `currentOrg` | no Redux needed |
| Money formatting | `Intl.NumberFormat('en-IN')` on rupees (paise/100) | ₹1,50,000 grouping |
| PDF / Excel | jsPDF + jspdf-autotable / SheetJS | report export |
| DB / Auth / API | Supabase | migrations in `supabase/migrations` |
| Backend logic | Postgres SQL functions | no Edge Functions for posting |

---

## 4. Database schema (final)

All tables: `org_id uuid not null`, RLS enabled, policy `using (is_org_member(org_id))` for SELECT; writes restricted as noted. Timestamps `timestamptz default now()`.

### 4.1 Tenancy & users
```
organizations(id pk, name, fy_start_month smallint default 4, created_at)
memberships(id pk, org_id fk, user_id fk auth.users, role check in('owner','accountant','staff'),
            created_at, unique(org_id,user_id))
```
RLS helper:
```sql
create function is_org_member(target_org uuid) returns boolean
  language sql security definer stable as $$
  select exists(select 1 from memberships m
                where m.org_id = target_org and m.user_id = auth.uid()); $$;

create function org_role(target_org uuid) returns text
  language sql security definer stable as $$
  select role from memberships
  where org_id = target_org and user_id = auth.uid(); $$;
```

### 4.2 Chart of accounts
```
account_groups(id smallint pk, name)   -- seed: 1 Asset,2 Liability,3 Equity,4 Income,5 Expense
accounts(id pk, org_id, code, name, group_id fk, parent_id fk accounts,
         is_control bool, is_inventory bool, is_system bool, is_active bool default true,
         created_at, unique(org_id,name))
index accounts(org_id, group_id)
```
**System accounts seeded per org on creation** (`is_system=true`, cannot delete): Cash, Bank, Sundry Debtors (control), Sundry Creditors (control), Sales, Purchases (transit, optional), Inventory (`is_inventory=true`), COGS, Opening Balance Equity, Retained Earnings, Round-off, GST Output (future), GST Input (future).

### 4.3 Parties as subsidiary ledgers
```
parties(id pk, org_id, name, kind check in('customer','supplier','both'), phone,
        ledger_account_id fk accounts, created_at)
index parties(org_id, kind)
```
Rule: creating a party auto-creates its `accounts` row with `parent_id` = Sundry Debtors (customer) or Sundry Creditors (supplier). Receivables/payables = sum of children of the control account. Done inside an RPC `create_party(...)`, not client insert.

### 4.4 Vouchers & ledger lines
```
voucher_types(id smallint pk, code, name)
  -- SALE,PURCHASE,RECEIPT,PAYMENT,CONTRA,JOURNAL,CREDIT_NOTE,DEBIT_NOTE,STOCK_JOURNAL,OPENING
voucher_sequences(org_id, voucher_type, fy_year smallint, next_no int default 1,
                  pk(org_id,voucher_type,fy_year))
vouchers(id pk, org_id, voucher_type fk, voucher_no text, date date, narration,
         party_id fk parties, status check in('posted','cancelled') default 'posted',
         reverses_id fk vouchers, created_by fk auth.users, created_at,
         unique(org_id,voucher_type,voucher_no))
index vouchers(org_id,date); index vouchers(org_id,party_id,date)

ledger_entries(id pk, org_id, voucher_id fk on delete cascade, account_id fk, party_id fk,
               debit bigint default 0, credit bigint default 0, date date,
               check((debit=0) <> (credit=0)), check(debit>=0 and credit>=0))
index ledger_entries(org_id,account_id,date)
index ledger_entries(org_id,voucher_id)
index ledger_entries(org_id,party_id,date)
```

### 4.5 Invoices, bills, allocations (bill-wise)
```
invoices(id pk, org_id, party_id, voucher_id, invoice_no, date, total bigint,
         outstanding bigint, created_at)
bills(id pk, org_id, party_id, voucher_id, bill_no, date, total bigint,
      outstanding bigint, created_at)
allocations(id pk, org_id, payment_voucher_id fk vouchers,
            target_kind check in('invoice','bill'), target_id uuid, amount bigint, created_at)
```

### 4.6 Inventory (perpetual, weighted average)
```
item_types(id smallint pk, code, name)  -- raw_material, finished_good, consumable, trading_good
stock_items(id pk, org_id, name, item_type fk, unit text,
            qty_on_hand numeric(18,4) default 0, avg_cost bigint default 0,
            value_on_hand bigint default 0, min_level numeric(18,4) default 0,
            is_active bool default true, created_at)
index stock_items(org_id, item_type)

stock_movements(id pk, org_id, stock_item_id fk, voucher_id fk, date date,
                qty_change numeric(18,4), unit_cost bigint, value_change bigint,
                balance_qty numeric(18,4), balance_value bigint, reason text, created_at)
index stock_movements(org_id, stock_item_id, date)
```
**Valuation (inside posting):**
- Inward: `new_value = value_on_hand + qty_in*unit_cost_in`; `new_qty = qty_on_hand + qty_in`; `avg_cost = round(new_value/new_qty)`.
- Outward: `value_out = qty_out*avg_cost`; `avg_cost` unchanged.
- Invariant: Inventory ledger balance == Σ `stock_items.value_on_hand`.

### 4.7 Period locking, snapshots, audit
```
period_locks(org_id pk, lock_upto date)
account_balance_snapshots(org_id, account_id, period date, closing_dr bigint, closing_cr bigint,
                          pk(org_id,account_id,period))
audit_log(id pk, org_id, user_id, action, entity, entity_id, detail jsonb, created_at)  -- append-only
```

### 4.8 Settings
```
org_settings(org_id pk, business_name, owner_name,
             negative_stock_policy check in('block','warn','allow') default 'warn', updated_at)
```

---

## 5. RLS & permission matrix

Enable RLS on all tables. Standard SELECT policy: `using (is_org_member(org_id))`.
Client write access on `ledger_entries`, `stock_movements`, `vouchers`, `invoices`, `bills`, `allocations`, `account_balance_snapshots`, `audit_log`: **REVOKE insert/update/delete** from `authenticated`. They are written only by `SECURITY DEFINER` RPC.

Role enforcement happens **inside the RPC** (via `org_role()`), not only in the UI:

| Action | owner | accountant | staff |
|---|---|---|---|
| Record sale / purchase / payment | ✓ | ✓ | ✓ |
| Create party / stock item | ✓ | ✓ | ✓ |
| Introduce capital / drawings | ✓ | ✓ | ✗ |
| Cancel voucher | ✓ | ✓ | ✗ |
| Close period / FY, lock | ✓ | ✓ | ✗ |
| View P&L / Balance Sheet | ✓ | ✓ | ✗ |
| Manage users | ✓ | ✗ | ✗ |

---

## 6. Accounting engine — RPC functions (the only write path)

Every function: single transaction, verifies membership + role, verifies date > `period_locks.lock_upto`, writes `audit_log`, returns the new id(s). All money args in paise.

### 6.1 Master poster
```
post_voucher(p_org uuid, p_type smallint, p_date date, p_party uuid,
             p_narration text, p_lines jsonb, p_stock jsonb) returns jsonb
```
`p_lines`: `[{account_id, party_id?, debit, credit}]` — must satisfy Σdebit=Σcredit (raise `unbalanced_voucher` otherwise).
`p_stock`: `[{stock_item_id, qty_change, unit_cost?, reason}]` — applies valuation, updates `stock_items`, appends `stock_movements`, and the function posts the matching inventory ledger line.
Steps: auth → lock check → balance check → lock `voucher_sequences` row & generate FY-aware gapless `voucher_no` → insert voucher + lines → apply stock → audit → return `{voucher_id, voucher_no}`.

### 6.2 Document wrappers (what the UI calls)
```
sell(p_org, p_date, p_party, p_lines_items jsonb, p_payment_mode, p_narration)
  -- p_lines_items: [{stock_item_id, qty, rate}]  (rate = selling price paise/unit)
  -- Builds: Dr Debtor (credit sale) OR Dr Cash/Bank (cash sale); Cr Sales (Σ qty*rate);
  --         optional Cr Round-off. For goods: Dr COGS / Cr Inventory at avg_cost; outward stock.
  --         Inserts invoice (outstanding=total) for credit sales.

purchase(p_org, p_date, p_party, p_lines_items jsonb, p_payment_mode, p_narration)
  -- p_lines_items: [{stock_item_id, qty, rate}] (rate = purchase cost paise/unit)
  -- Dr Inventory (Σ qty*rate), Cr Creditor (credit) or Cr Cash/Bank (cash); inward stock;
  --   insert bill (outstanding=total) for credit purchases.

receive_payment(p_org, p_date, p_party, p_amount, p_mode, p_allocations jsonb, p_narration)
  -- Dr Cash/Bank, Cr Debtor; allocate to invoices, reduce outstanding; insert allocations.

make_payment(p_org, p_date, p_party, p_amount, p_mode, p_allocations jsonb, p_narration)
  -- Dr Creditor, Cr Cash/Bank; allocate to bills.

contra(p_org, p_date, p_from_account, p_to_account, p_amount, p_narration)  -- cash↔bank
expense(p_org, p_date, p_expense_account, p_amount, p_mode, p_party?, p_narration)  -- Dr expense, Cr Cash/Bank
sales_return(p_org, p_date, p_party, p_orig_invoice, p_lines_items, p_narration)   -- credit note + inward at orig avg cost
purchase_return(p_org, p_date, p_party, p_orig_bill, p_lines_items, p_narration)   -- debit note + outward
introduce_capital(p_org, p_date, p_amount, p_mode)   -- Dr Cash/Bank, Cr Capital
drawings(p_org, p_date, p_amount, p_mode)            -- Dr Drawings, Cr Cash/Bank
opening_balances(p_org, p_entries jsonb, p_stock jsonb)
  -- Posts all opening balances against 'Opening Balance Equity' (must net to zero);
  --   seeds stock_items qty + avg_cost + inventory ledger. Validates net-zero or raises.
create_party(p_org, p_name, p_kind, p_phone) returns uuid  -- creates party + child ledger account
create_stock_item(p_org, p_name, p_item_type, p_unit, p_min_level) returns uuid
```

### 6.3 Cancellation & corrections
```
cancel_voucher(p_org, p_voucher)
  -- set status='cancelled'; insert reversing voucher (swap dr/cr; negate stock at original cost);
  --   set reverses_id; restore invoice/bill outstanding & remove allocations. Originals never deleted.
```

### 6.4 Period close & year-end
```
close_period(p_org, p_month date)        -- compute account_balance_snapshots, set period_lock = month end
close_financial_year(p_org, p_fy_year)   -- net Income−Expense → Retained Earnings (Equity); lock FY
```

**Error codes (raised as Postgres exceptions, surfaced to UI):** `not_member`, `forbidden_role`, `period_locked`, `unbalanced_voucher`, `negative_stock_blocked`, `allocation_exceeds_outstanding`, `opening_not_zero`.

---

## 7. API contract (frontend ↔ Supabase)

**Reads** — `supabase.from('<view>').select(...)` (RLS-filtered). Views to build:
`v_trial_balance`, `v_profit_loss`, `v_balance_sheet`, `v_aged_receivables`, `v_aged_payables`,
`v_party_ledger`, `v_stock_valuation`, `v_stock_ledger`, `v_day_book`, `v_dashboard_summary`,
`v_low_stock`, `v_inventory_reconciliation`, plus simple list views for parties / items / vouchers.

**Writes** — `supabase.rpc('<name>', { ... })` only. Errors map by `error.message` (Postgres SQLSTATE) → friendly toast.

Reports read **snapshots + current-period deltas**, never full history:
- **Trial Balance (as-of):** latest snapshot per account + entries after snapshot; assert Σdr=Σcr.
- **P&L (range):** income − expense; COGS is real, so gross profit is meaningful.
- **Balance Sheet (as-of):** Assets = Liabilities + Equity (equity includes opening retained earnings + current-year P&L); must net to zero.
- **Aged Receivables/Payables:** from `outstanding`, buckets 0–30/31–60/61–90/90+.
- **Party Ledger / Stock Ledger / Day Book / Stock Valuation:** as named.

---

## 8. UX & mobile-first design system

**Design at 360px first; scale up.** Single-column by default; two-column only ≥ 768px.

**Layout shell**
- Bottom tab bar (mobile) / left rail (desktop): **Home · Sales · Purchases · Money · Reports**.
- A persistent **"+ New"** FAB → quick sheet: Sell, Buy, Receive, Pay, Expense.
- Top bar: org switcher (if multi-org) + sync/offline indicator.

**Plain language (staff-facing).** Never show "debit/credit" to staff. Use: *Sell goods, Buy goods, Money received, Money paid, Expense, Customer owes, We owe*. The double-entry happens invisibly in the RPC. Accountant/owner can switch on an "Accounting view" to see ledger terms.

**Form rules**
- ≤ 4 fields visible before Save; advanced fields behind "More".
- Smart defaults: date = today, payment mode = last used, party = autocomplete with recent first.
- Money input in rupees with `en-IN` grouping; converted to paise on submit.
- Large tap targets (min 44px), numeric keypads for money/qty, sticky Save button above keyboard.
- Optimistic UI on reads via TanStack Query; writes show a spinner + success toast with the voucher number.

**Feedback & trust**
- Every successful post shows the **voucher number** ("Saved · SALE/2025-26/0007").
- Errors are plain ("This date is in a locked period", "Stock would go negative").
- Destructive actions (cancel voucher) require confirm + show what reverses.

**Accessibility:** semantic HTML, focus states, color-contrast AA, labels on every input.

---

## 9. Screen inventory (frontend scope)

**Auth & onboarding**
1. Sign in / sign up (email OTP + password).
2. Create organization (name, FY start month) → seeds accounts + settings.
3. Onboarding wizard: business details, opening balances (cash/bank, debtors, creditors), opening stock → calls `opening_balances`.
4. Invite users / assign roles (owner only).

**Home**
5. Dashboard: cash & bank balance, receivables, payables, today's sales, low-stock count, recent vouchers. (`v_dashboard_summary`)

**Sales**
6. Sell goods (items + qty + rate, cash/credit, party). → `sell`
7. Sales list / invoice list with outstanding.
8. Sales return (credit note). → `sales_return`

**Purchases**
9. Buy goods. → `purchase`
10. Purchase list / bills with outstanding.
11. Purchase return (debit note). → `purchase_return`

**Money**
12. Receive payment (pick party → allocate to invoices). → `receive_payment`
13. Make payment (allocate to bills). → `make_payment`
14. Expense (rent, wages, electricity…). → `expense`
15. Contra (cash↔bank). → `contra`
16. Capital / Drawings (owner/accountant). → `introduce_capital` / `drawings`

**Masters**
17. Parties (list, create via `create_party`).
18. Stock items (list, create via `create_stock_item`, low-stock badge).

**Reports** (owner/accountant; staff limited)
19. Trial Balance · 20. P&L · 21. Balance Sheet · 22. Aged Receivables/Payables · 23. Party Ledger · 24. Stock Valuation & Ledger · 25. Day Book · 26. Inventory↔GL Reconciliation. All with PDF/Excel export.

**Admin**
27. Period close / FY close / lock (owner/accountant). → `close_period`, `close_financial_year`
28. Audit log view. 29. Org settings (negative-stock policy, business details).

---

## 10. Frontend project structure
```
src/
  lib/supabase.ts            // client
  lib/money.ts               // paise<->rupee, en-IN formatting
  lib/rpc.ts                 // typed wrappers over supabase.rpc with error mapping
  hooks/useOrg.ts            // current org context
  hooks/queries/*.ts         // TanStack Query hooks per view
  components/ui/*            // shadcn primitives
  components/AppShell.tsx    // bottom nav / rail + FAB
  features/auth/*
  features/onboarding/*
  features/sales/*
  features/purchases/*
  features/money/*
  features/masters/*
  features/reports/*
  features/admin/*
  routes.tsx
supabase/
  migrations/*.sql           // schema, RLS, functions, views, seeds
  seed.sql                   // account_groups, item_types, voucher_types
```

---

## 11. Inventory ↔ accounting synchronization (explicit)

- Single source of truth: `stock_movements` (append-only running qty + value per item).
- `stock_items.{qty_on_hand, avg_cost, value_on_hand}` is the cached head, updated **only** inside `post_voucher`.
- `v_inventory_reconciliation` asserts `Inventory ledger balance == Σ stock_items.value_on_hand`; surfaced as a health check on the dashboard for owner/accountant.
- Negative stock honours `org_settings.negative_stock_policy` (`block` raises, `warn` allows + flags, `allow` silent).
- Item types leave room for a future `manufacture(...)` voucher (RM→FG) with no schema change.

---

## 12. Indian conventions

- Money: bigint paise; display `(paise/100).toLocaleString('en-IN')` → ₹1,50,000.
- FY: April–March; voucher numbers & reports FY-scoped; label "FY 2025-26".
- Dates: store ISO, display DD-MM-YYYY.
- Invoice numbers gapless per FY (legal expectation) — enforced by `voucher_sequences` row lock.

---

## 13. Acceptance tests (must pass before "done")

1. Buy ₹1,00,000 steel on credit → Inventory +₹1,00,000, supplier payable +₹1,00,000; P&L unchanged.
2. Sell goods costing ₹40,000 for ₹70,000 → Sales +70,000, COGS +40,000, gross profit 30,000, inventory −40,000.
3. Trial balance after any sequence → Σdebit = Σcredit exactly.
4. Balance sheet any date → Assets = Liabilities + Equity; difference = 0.
5. Inventory ledger balance = Σ stock_items.value_on_hand at all times.
6. ₹30,000 receipt across two invoices → both outstandings reduce; aged report reflects it.
7. Cancel a posted sale → originals intact, reversing voucher added, balances & stock restored.
8. Post into a locked period → rejected (`period_locked`).
9. Buy 100kg@₹50 then 100kg@₹60, consume 150kg → avg ₹55, consumption ₹8,250, closing 50kg@₹55=₹2,750.
10. Staff views P&L or introduces capital → denied by RPC role check.
11. Two orgs, shared CA → CA sees only member orgs; no cross-org leakage.
12. **Mobile:** every primary action (Sell/Buy/Receive/Pay) completable one-handed at 360px in ≤ 5 taps.

---

## 14. Build order (hand each phase to Claude Code)

**Phase 1 — Tenancy + ledger core**
Migrations: organizations, memberships, `is_org_member`/`org_role`, account_groups + accounts (+ per-org system-account seeding), voucher_types/sequences, vouchers, ledger_entries with CHECKs, RLS + revokes. RPC: `post_voucher`, `expense`, `contra`, `opening_balances`, `create_party`, `create_stock_item`. Views: `v_dashboard_summary`, `v_day_book`, `v_trial_balance`. Frontend: Supabase client, auth, create-org + onboarding (opening balances), AppShell + bottom nav, dashboard.

**Phase 2 — Parties, invoices, payments**
Parties as sub-ledgers, `sell`/`purchase` (with inventory + COGS), invoices/bills, `receive_payment`/`make_payment` + allocations. Views: `v_party_ledger`, `v_aged_receivables`, `v_aged_payables`. Frontend: Sell/Buy/Receive/Pay screens, party & item masters, sales/purchase lists.

**Phase 3 — Inventory depth**
stock_items/item_types/stock_movements wiring, weighted-average valuation inside posting, negative-stock policy, low-stock alerts. Views: `v_stock_valuation`, `v_stock_ledger`, `v_low_stock`, `v_inventory_reconciliation`. Frontend: stock screens + reconciliation health card.

**Phase 4 — Reports, close, polish**
`v_profit_loss`, `v_balance_sheet`, `close_period`/`close_financial_year`, snapshots, period locking, `sales_return`/`purchase_return`, PDF/Excel export, role enforcement audit, audit-log view, full mobile pass + accessibility.

**Future (schema already supports):** `manufacture(...)` BOM RM→FG, UOM conversion, cash-flow statement, GST output/input + returns, batch/lot tracking.

---

## 15. Definition of done (per phase)

- All migrations apply cleanly on a fresh Supabase project (`supabase db reset`).
- Every table has RLS; client write to ledger tables is revoked; only RPC writes.
- Relevant acceptance tests (§13) pass with seeded sample data.
- Screens for the phase work one-handed at 360px and on desktop.
- No floats touch money; all amounts round-trip paise↔rupee correctly.
