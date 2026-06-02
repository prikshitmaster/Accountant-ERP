# Insights (Visual Trends + Smart Insights) — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — pending spec review
**Feature:** A new "Insights" screen — glance-able, plain-language business intelligence (smart insight cards + monthly trend charts). Phase 1 of a 4-part Insights roadmap.

## Goal

Give a non-expert owner immediate, plain-language understanding of how the business is doing — trends and insights, not dense tables. This is the visible "ahead-of-competitors" layer most Indian accounting software lacks. It also lays the charting foundation reused by later phases (Profitability, Cash outlook, Inventory intelligence).

## Roadmap context (this is Phase 1 of 4)

1. **Visual trends + smart insights** ← this spec (adds charting + the Insights screen)
2. Profitability analytics (margins by item/customer)
3. Cash & collection outlook (cash-flow statement + forecast)
4. Inventory intelligence (turnover, dead stock)

Each later phase is its own spec → plan → build and plugs into the Insights screen built here.

## Scope (this phase)

- A new **Insights** screen at `/insights`, reachable from a dedicated nav entry (above Reports).
- **Smart insight cards** (3–4): auto-written, plain-language sentences with up/down cues.
- **Hero trend chart:** monthly **Sales** (bars) + **Profit** (line), last 12 months.
- **Income vs Expense** monthly chart.
- One new read-only SQL view; `recharts` added for charts.

## Non-goals (this phase)

- Profitability-by-item/customer, cash-flow statement/forecast, inventory turnover (later phases).
- Any change to posting, RPCs, or existing reports.
- Export of the Insights screen (the tabular Reports already export; charts export is a later nicety).

## Architecture

### Data — one new view, no engine changes

`v_monthly_pl` (security_invoker, granted to `authenticated`): for each org and each month, aggregate `ledger_entries` joined to `accounts` into P&L building blocks. One row per `(org_id, month)`:

| column | meaning | derivation |
|---|---|---|
| `org_id` | tenant | |
| `month` | first day of month (date) | `date_trunc('month', le.date)` |
| `sales` | revenue | `sum(credit - debit)` where `accounts.system_key = 'sales'` |
| `cogs` | cost of goods sold | `sum(debit - credit)` where `system_key = 'cogs'` |
| `gross_profit` | sales − cogs | computed |
| `income` | all income | `sum(credit - debit)` where `group_id = 4` |
| `expense` | all expense | `sum(debit - credit)` where `group_id = 5` |
| `net_profit` | income − expense | computed |

RLS is enforced via the underlying tables (security_invoker view); only `is_org_member` rows are visible. The view bounds nothing by date — the client requests the last 12 months.

### Smart insight cards — computed client-side

No new backend. The Insights page composes insights from data it already fetches:
- **Sales this month + MoM %** — from `v_monthly_pl` (this month vs last month `sales`).
- **Overdue receivables** — total + count from `v_aged_receivables` (existing `useAged`).
- **Biggest expense this month** — from a small existing read (top `group_id = 5` account by amount this month) via `v_day_book`/ledger; if not readily available, derive from `v_monthly_pl` expense + a lightweight per-account month query (`v_trial_balance`-style). Card omitted gracefully if data is absent.
- **Cash + bank** — from `v_dashboard_summary` (existing `useDashboard`).

Each card states a plain sentence and a tone (pos/neg/neutral) with an up/down arrow. Cards self-hide when their data isn't meaningful (e.g., no prior month → no MoM card).

### Charts — `recharts`, styled to match

Add `recharts` (pure dependency, touches no existing code). A small wrapper component applies the design language: indigo series, soft/!no heavy gridlines, rounded bars, tabular-figure tooltips, responsive container. Two charts:
- **`SalesProfitChart`** — composed bar (sales) + line (profit), 12 months.
- **`IncomeExpenseChart`** — grouped bars (income vs expense), 12 months.

### Files

- **Create** `supabase/migrations/0011_insights.sql` — `v_monthly_pl` + grant.
- **Modify** `src/hooks/queries.ts` — `useMonthlyPL(orgId)` hook + `MonthlyPL` type.
- **Create** `src/features/insights/InsightsPage.tsx` — the screen (header, insight cards, charts).
- **Create** `src/features/insights/charts.tsx` — `SalesProfitChart`, `IncomeExpenseChart` (recharts wrappers).
- **Create** `src/features/insights/insights.ts` — pure functions that turn data into insight-card view-models (unit-testable, no React).
- **Modify** `src/App.tsx` — `/insights` route.
- **Modify** `src/components/AppShell.tsx` — "Insights" nav entry (sidebar + mobile "More").
- **Modify** `package.json` — add `recharts`.

## Money & formatting

All amounts are paise (bigint) end-to-end; formatted with the existing `formatINR`. Charts receive rupees (paise/100) for axis readability; tooltips use `formatINR`. No floats touch stored money.

## Testing

- **DB:** new `scripts/test-insights.mjs` (transactional, rolled back): seed a couple of sales/purchases/expenses across two months, then assert `v_monthly_pl` for the org: `sales`, `cogs`, `gross_profit = sales - cogs`, `net_profit = income - expense`, and that summing `net_profit` across months reconciles with the existing P&L view total. Plus regression: smoke-test, test-phase2, test-manufacture, test-masters stay green.
- **Unit:** `insights.ts` pure functions tested for: MoM % (incl. divide-by-zero / no prior month), tone selection, and graceful omission when inputs are empty. (Lightweight: a `scripts/test-insights-unit.mjs` or inline assertions, since the repo has no jest harness — mirror the existing node-script test style.)
- **Frontend:** `npx tsc --noEmit` and `npm run build` clean.

## Definition of done

- Migration applies on the cloud project; `v_monthly_pl` reconciles with P&L (test green).
- Insights screen at `/insights` shows insight cards + both charts, reads in plain language, works at 360px and desktop.
- Charts styled to match the design (not stock recharts look).
- All existing test suites green; tsc + build clean.
- No change to posting, RPCs, or existing reports.
