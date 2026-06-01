# Books — Accounting & Stock (React + Supabase)

Production-grade double-entry accounting + perpetual inventory for Indian SMEs.
See [`SPEC.md`](./SPEC.md) for the full architecture. This repo currently implements **Phase 1**.

## Phase 1 status

**Backend (Postgres migrations in `supabase/migrations/`)**
- `0001_schema.sql` — tenancy, chart of accounts, parties, vouchers, ledger, inventory, locks, audit, settings + helpers.
- `0002_rls.sql` — RLS on every table; financial-core writes revoked from clients.
- `0003_functions.sql` — accounting engine: `create_organization`, `post_voucher`, `expense`, `contra`, `introduce_capital`, `drawings`, `opening_balances`, `create_party`, `create_stock_item`, `cancel_voucher`.
- `0004_views.sql` — `v_trial_balance`, `v_day_book`, `v_dashboard_summary` (security_invoker).

**Frontend (`src/`)** — Vite + React + TS + Tailwind v4 + TanStack Query
- Auth (email/password), create-organisation + opening-balances onboarding.
- Mobile-first AppShell (bottom nav), Dashboard, Money (Expense / Cash↔Bank / Capital / Drawings), Reports (Trial Balance + Day Book), Settings.

## Run

### 1. Database
**Option A — Local (needs Docker + WSL2):**
```bash
supabase start          # applies all migrations to a local Postgres
supabase status         # copy API URL + anon key into .env.local
```
**Option B — Cloud Supabase:**
```bash
supabase link --project-ref <your-ref>
supabase db push        # applies migrations to your cloud project
# then copy Project Settings → API URL + anon key into .env.local
```

> Note: this machine currently has **WSL2 disabled**, so Docker Desktop (and therefore
> local Supabase) won't start. Use Option B, or enable WSL2 (`wsl --install`, reboot) for Option A.

### 2. Frontend
```bash
cp .env.example .env.local   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Money & data conventions
- Money stored as **bigint paise**; UI formats with `en-IN` grouping (₹1,50,000.00).
- All writes go through `supabase.rpc(...)`; clients cannot write the ledger directly.
- FY April–March; gapless FY-scoped voucher numbers (e.g. `PAYMENT/2025-26/0001`).
