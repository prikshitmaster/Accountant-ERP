# Richer Party & Item Masters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Add Party and Add Item forms to Miracle-level detail (address, contact, tax IDs, credit terms, opening balances, default prices) via progressive disclosure, without altering verified accounting.

**Architecture:** Additive `alter table … add column if not exists` on `parties`/`stock_items`; `create_party`/`create_stock_item` dropped and recreated with appended optional params (new fields via a `p_details jsonb`, plus optional opening-balance/stock params that post real `OPENING` vouchers through the existing `post_voucher`). Group/alias are plain reporting metadata — the party ledger account stays parented under Sundry Debtors/Creditors, so receivables/payables/balance sheet are untouched. Frontend forms gain a collapsible "▸ More details" block.

**Tech Stack:** PostgreSQL (plpgsql RPC), Node `pg` test scripts (transactional + rollback), React + TypeScript + Tailwind + TanStack Query.

**Reference spec:** `docs/superpowers/specs/2026-06-02-richer-masters-design.md`

## Environment notes (read once)

- Tests/migrations run against the cloud project. `DATABASE_URL` is in `.env.local` (gitignored). Export it first:
  `export DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | sed 's/^DATABASE_URL=//')"`
- Apply one migration only: `node scripts/run-migrations.mjs 0010`
- Test harness pattern: see `scripts/smoke-test.mjs` (fake auth via `request.jwt.claims`, run RPCs, assert, `ROLLBACK`). Wrap any expected-error RPC call in a `SAVEPOINT` (a failed statement aborts the whole transaction).

## File Structure

- **Create** `scripts/test-masters.mjs` — transactional acceptance test.
- **Create** `supabase/migrations/0010_masters.sql` — column adds, recreated RPCs, `v_parties` update, grants.
- **Modify** `src/hooks/queries.ts` — extend `Party`/`Item` types and the `useItems` select.
- **Modify** `src/lib/rpc.ts` — extend `createParty`/`createStockItem` wrappers.
- **Modify** `src/features/masters/PartiesPage.tsx` — richer form + group filter.
- **Modify** `src/features/masters/ItemsPage.tsx` — richer form.
- **Modify** `src/components/ItemLines.tsx` — default-price prefill on item select.
- **Modify** `src/features/sales/SalesPage.tsx` — credit-limit soft warning + sale-price prefill.
- **Modify** `src/features/purchases/PurchasesPage.tsx` — purchase-price prefill.

---

## Task 1: Masters acceptance test (write first, must fail)

**Files:**
- Test: `scripts/test-masters.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-masters.mjs`:

```js
// Transactional acceptance test for richer party/item masters.
// Fakes an authenticated user, exercises create_party/create_stock_item with
// the new params + opening postings, asserts invariants, then ROLLS BACK.
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const uid = '33333333-3333-3333-3333-333333333333'
let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

const run = async () => {
  await client.connect()
  await client.query('begin')
  try {
    await client.query(
      `insert into auth.users (id, aud, role, email, created_at, updated_at)
       values ($1,'authenticated','authenticated','masters@test.local', now(), now())`, [uid])
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' })])

    const org = (await client.query(`select create_organization('Masters Co', 4::smallint) as id`)).rows[0].id
    const acct = async (k) =>
      (await client.query(`select id from accounts where org_id=$1 and system_key=$2`, [org, k])).rows[0].id
    const obe = await acct('opening_equity')
    const inv = await acct('inventory')
    const tbBalanced = async () => {
      const r = (await client.query(
        `select coalesce(sum(closing_debit),0)::bigint dr, coalesce(sum(closing_credit),0)::bigint cr
         from v_trial_balance where org_id=$1`, [org])).rows[0]
      return Number(r.dr) === Number(r.cr)
    }
    const acctBal = async (id) =>
      Number((await client.query(
        `select coalesce(sum(debit-credit),0)::bigint b from ledger_entries where org_id=$1 and account_id=$2`,
        [org, id])).rows[0].b)

    // 1) backward compat: old-style 6-arg call still works
    const p0 = (await client.query(
      `select create_party($1,'Old Style','customer','9990001111','07AABCT1234E1Z5','07') as id`, [org])).rows[0].id
    check('backward-compat create_party (6 args)', !!p0)

    // 2) full party via p_details, no opening
    const details = {
      alias: 'ACME', group_name: 'Wholesale', area: 'MG Road', city: 'Delhi', pincode: '110001',
      billing_address: '12 Main St', shipping_address: 'Dock 4', email: 'a@acme.com',
      contact_person: 'Ravi', pan: 'AABCT1234E', aadhaar: '123412341234',
      udyam_no: 'UDYAM-DL-01-0001', msme_activity: 'Trader', credit_limit: 5000000, credit_days: 30,
    }
    const p1 = (await client.query(
      `select create_party($1,'Acme Traders','customer',null,null,'07',$2::jsonb,0,null,null) as id`,
      [org, JSON.stringify(details)])).rows[0].id
    const prow = (await client.query(`select * from parties where id=$1`, [p1])).rows[0]
    check('party stores alias/group/city', prow.alias === 'ACME' && prow.group_name === 'Wholesale' && prow.city === 'Delhi')
    check('party stores credit_limit/days', Number(prow.credit_limit) === 5000000 && prow.credit_days === 30)
    check('party ledger still parented under debtors',
      (await client.query(`select a.parent_id = (select id from accounts where org_id=$1 and system_key='debtors')
                           as ok from accounts a where a.id=$2`, [org, prow.ledger_account_id])).rows[0].ok)

    // 3) party opening (dr) — customer owes us 10,000
    const p2 = (await client.query(
      `select create_party($1,'Owes Us','customer',null,null,'07','{}'::jsonb,1000000,'dr','2026-04-01') as id`, [org])).rows[0].id
    const p2acct = (await client.query(`select ledger_account_id from parties where id=$1`, [p2])).rows[0].ledger_account_id
    check('party opening dr: party ledger Dr 10,000', (await acctBal(p2acct)) === 1000000)
    check('trial balance balanced after party opening dr', await tbBalanced())

    // 4) party opening (cr) — we owe supplier 8,000
    const p3 = (await client.query(
      `select create_party($1,'We Owe','supplier',null,null,'07','{}'::jsonb,800000,'cr','2026-04-01') as id`, [org])).rows[0].id
    const p3acct = (await client.query(`select ledger_account_id from parties where id=$1`, [p3])).rows[0].ledger_account_id
    check('party opening cr: supplier ledger Cr 8,000', (await acctBal(p3acct)) === -800000)
    check('trial balance balanced after party opening cr', await tbBalanced())

    // 5) backward compat item + full item with opening stock
    const i0 = (await client.query(
      `select create_stock_item($1,'Old Item',4::smallint,'pcs',0,'1234',18) as id`, [org])).rows[0].id
    check('backward-compat create_stock_item (7 args)', !!i0)

    const idet = { item_code: 'SKU-1', category: 'Hardware', description: 'M8 bolt', sale_price: 1500, purchase_price: 1000 }
    const i1 = (await client.query(
      `select create_stock_item($1,'Bolt',4::smallint,'pcs',5,'7318',18,$2::jsonb,100,5000,'2026-04-01') as id`,
      [org, JSON.stringify(idet)])).rows[0].id
    const irow = (await client.query(`select * from stock_items where id=$1`, [i1])).rows[0]
    check('item stores code/category/prices',
      irow.item_code === 'SKU-1' && irow.category === 'Hardware' &&
      Number(irow.sale_price) === 1500 && Number(irow.purchase_price) === 1000)
    check('item opening stock qty=100', Number(irow.qty_on_hand) === 100)
    check('item opening avg_cost=5000', Number(irow.avg_cost) === 5000)
    check('item opening value=500000', Number(irow.value_on_hand) === 500000)
    check('inventory ledger == stock value', (await acctBal(inv)) === 500000)
    check('trial balance balanced after item opening', await tbBalanced())

    // 6) aadhaar must not be written to audit_log
    const auditHasAadhaar = (await client.query(
      `select count(*)::int n from audit_log where org_id=$1 and detail::text like '%123412341234%'`, [org])).rows[0].n
    check('aadhaar NOT in audit_log', auditHasAadhaar === 0, `found ${auditHasAadhaar}`)

    void obe
  } finally {
    await client.query('rollback')
    await client.end()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | sed 's/^DATABASE_URL=//')"; node scripts/test-masters.mjs`
Expected: FAIL — `create_party(...10 args...)` / new columns don't exist yet (error `42883` or `42703`).

- [ ] **Step 3: Commit the failing test**

```bash
git add scripts/test-masters.mjs
git commit -m "test: richer masters acceptance test (red)"
```

---

## Task 2: Migration — columns, recreated RPCs, view

**Files:**
- Create: `supabase/migrations/0010_masters.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_masters.sql`:

```sql
-- =============================================================
-- Richer party & item masters. Additive columns + wider RPCs.
-- Group/alias are plain reporting metadata (no constraints, no
-- effect on the ledger account parent). Opening balances post real
-- OPENING vouchers (type 10) through post_voucher. Backward compatible.
-- =============================================================

-- ---------- Additive columns ----------
alter table parties add column if not exists alias            text;
alter table parties add column if not exists group_name       text;
alter table parties add column if not exists area             text;
alter table parties add column if not exists city             text;
alter table parties add column if not exists pincode          text;
alter table parties add column if not exists billing_address  text;
alter table parties add column if not exists shipping_address text;
alter table parties add column if not exists email            text;
alter table parties add column if not exists contact_person   text;
alter table parties add column if not exists pan              text;
alter table parties add column if not exists aadhaar          text;
alter table parties add column if not exists udyam_no         text;
alter table parties add column if not exists msme_activity    text;
alter table parties add column if not exists credit_limit     bigint not null default 0;  -- paise
alter table parties add column if not exists credit_days      int    not null default 0;

alter table stock_items add column if not exists item_code      text;
alter table stock_items add column if not exists category       text;
alter table stock_items add column if not exists description    text;
alter table stock_items add column if not exists sale_price     bigint not null default 0; -- paise
alter table stock_items add column if not exists purchase_price bigint not null default 0; -- paise

-- ---------- create_party (drop old 6-arg, recreate wider) ----------
drop function if exists create_party(uuid, text, text, text, text, text);
create or replace function create_party(
  p_org uuid, p_name text, p_kind text, p_phone text default null,
  p_gstin text default null, p_state_code text default null,
  p_details jsonb default '{}'::jsonb,
  p_opening_amount bigint default 0, p_opening_type text default null,
  p_opening_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_parent uuid; v_group smallint; v_account uuid; v_party uuid;
  v_obe uuid; v_lines jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if p_kind = 'supplier' then v_parent := sys_account(p_org,'creditors'); v_group := 2;
  else                        v_parent := sys_account(p_org,'debtors');   v_group := 1; end if;

  insert into accounts (org_id, name, group_id, parent_id)
    values (p_org, p_name, v_group, v_parent) returning id into v_account;

  insert into parties (
    org_id, name, kind, phone, ledger_account_id, gstin, state_code,
    alias, group_name, area, city, pincode, billing_address, shipping_address,
    email, contact_person, pan, aadhaar, udyam_no, msme_activity, credit_limit, credit_days)
  values (
    p_org, p_name, p_kind, p_phone, v_account, p_gstin, p_state_code,
    p_details->>'alias', p_details->>'group_name', p_details->>'area', p_details->>'city',
    p_details->>'pincode', p_details->>'billing_address', p_details->>'shipping_address',
    p_details->>'email', p_details->>'contact_person', p_details->>'pan', p_details->>'aadhaar',
    p_details->>'udyam_no', p_details->>'msme_activity',
    coalesce((p_details->>'credit_limit')::bigint, 0), coalesce((p_details->>'credit_days')::int, 0))
  returning id into v_party;

  -- audit: name/kind ONLY (never aadhaar/PII)
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CREATE_PARTY', 'party', v_party,
            jsonb_build_object('name', p_name, 'kind', p_kind));

  -- optional opening balance as a real OPENING voucher
  if coalesce(p_opening_amount, 0) > 0 then
    v_obe := sys_account(p_org, 'opening_equity');
    if p_opening_type = 'cr' then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_obe, 'debit', p_opening_amount, 'credit', 0),
        jsonb_build_object('account_id', v_account, 'party_id', v_party, 'debit', 0, 'credit', p_opening_amount));
    else
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_account, 'party_id', v_party, 'debit', p_opening_amount, 'credit', 0),
        jsonb_build_object('account_id', v_obe, 'debit', 0, 'credit', p_opening_amount));
    end if;
    perform post_voucher(p_org, 10::smallint, coalesce(p_opening_date, current_date),
                         v_party, 'Opening balance', v_lines, '[]'::jsonb);
  end if;

  return v_party;
end; $$;

-- ---------- create_stock_item (drop old 7-arg, recreate wider) ----------
drop function if exists create_stock_item(uuid, text, smallint, text, numeric, text, numeric);
create or replace function create_stock_item(
  p_org uuid, p_name text, p_item_type smallint, p_unit text,
  p_min_level numeric default 0, p_hsn text default null, p_gst_rate numeric default 0,
  p_details jsonb default '{}'::jsonb,
  p_opening_qty numeric default 0, p_opening_rate bigint default 0,
  p_opening_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org); v_item uuid;
  v_inv uuid; v_obe uuid; v_val bigint; v_lines jsonb; v_stock jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;

  insert into stock_items (
    org_id, name, item_type, unit, min_level, hsn, gst_rate,
    item_code, category, description, sale_price, purchase_price)
  values (
    p_org, p_name, p_item_type, p_unit, coalesce(p_min_level,0), p_hsn, coalesce(p_gst_rate,0),
    p_details->>'item_code', p_details->>'category', p_details->>'description',
    coalesce((p_details->>'sale_price')::bigint, 0), coalesce((p_details->>'purchase_price')::bigint, 0))
  returning id into v_item;

  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CREATE_STOCK_ITEM', 'stock_item', v_item,
            jsonb_build_object('name', p_name));

  -- optional opening stock as a real OPENING voucher
  if coalesce(p_opening_qty, 0) > 0 then
    v_inv := sys_account(p_org, 'inventory');
    v_obe := sys_account(p_org, 'opening_equity');
    v_val := round(p_opening_qty * coalesce(p_opening_rate, 0));
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_inv, 'debit', v_val, 'credit', 0),
      jsonb_build_object('account_id', v_obe, 'debit', 0, 'credit', v_val));
    v_stock := jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item, 'qty_change', p_opening_qty, 'unit_cost', coalesce(p_opening_rate,0),
      'reason', 'Opening stock'));
    perform post_voucher(p_org, 10::smallint, coalesce(p_opening_date, current_date),
                         null, 'Opening stock', v_lines, v_stock);
  end if;

  return v_item;
end; $$;

-- ---------- v_parties: expose new reporting columns ----------
drop view if exists v_parties;
create view v_parties with (security_invoker = on) as
select
  p.org_id, p.id, p.name, p.kind, p.phone, p.ledger_account_id, p.gstin, p.state_code,
  p.group_name, p.city, p.credit_limit, p.credit_days,
  coalesce((select sum(le.debit - le.credit) from ledger_entries le
            where le.org_id = p.org_id and le.account_id = p.ledger_account_id), 0) as balance
from parties p;

-- ---------- grants ----------
grant select on v_parties to authenticated;
grant execute on function create_party(uuid, text, text, text, text, text, jsonb, bigint, text, date) to authenticated;
grant execute on function create_stock_item(uuid, text, smallint, text, numeric, text, numeric, jsonb, numeric, bigint, date) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `export DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | sed 's/^DATABASE_URL=//')"; node scripts/run-migrations.mjs 0010`
Expected: `Applying 0010_masters.sql … ok`.

- [ ] **Step 3: Run the masters test to verify it passes**

Run: `node scripts/test-masters.mjs` (with DATABASE_URL exported)
Expected: all checks `PASS`, `0 failed`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0010_masters.sql
git commit -m "feat(db): richer party/item masters + opening postings"
```

---

## Task 3: Regression — existing suites still pass

**Files:** none

- [ ] **Step 1: Run all three existing suites**

Run (DATABASE_URL exported):
```bash
node scripts/smoke-test.mjs
node scripts/test-phase2.mjs
node scripts/test-manufacture.mjs
```
Expected: `8 passed, 0 failed`, `12 passed, 0 failed`, `14 passed, 0 failed`.

> If any fail, STOP and fix `0010_masters.sql` (most likely the recreated RPC bodies). This is the "don't break anything" gate. Re-run Task 2 Step 3 and this task until all green.

- [ ] **Step 2: Commit (only if a fix was needed)**

```bash
git add supabase/migrations/0010_masters.sql
git commit -m "fix(db): keep masters regression green"
```

---

## Task 4: Frontend types + RPC wrappers

**Files:**
- Modify: `src/hooks/queries.ts`
- Modify: `src/lib/rpc.ts`

- [ ] **Step 1: Extend the `Party` type**

In `src/hooks/queries.ts`, replace the `Party` type with:

```ts
export type Party = {
  id: string; name: string; kind: 'customer' | 'supplier' | 'both'
  phone: string | null; balance: number; gstin: string | null; state_code: string | null
  group_name: string | null; city: string | null; credit_limit: number; credit_days: number
}
```

- [ ] **Step 2: Extend the `Item` type and the `useItems` select**

In `src/hooks/queries.ts`, replace the `Item` type with:

```ts
export type Item = {
  id: string; name: string; item_type: number; unit: string
  qty_on_hand: number; avg_cost: number; value_on_hand: number
  min_level: number; hsn: string | null; gst_rate: number
  item_code: string | null; category: string | null; description: string | null
  sale_price: number; purchase_price: number
}
```

And replace the `.select(...)` line in `useItems` with:

```ts
        .select('id, name, item_type, unit, qty_on_hand, avg_cost, value_on_hand, min_level, hsn, gst_rate, item_code, category, description, sale_price, purchase_price')
```

- [ ] **Step 3: Extend the `createParty` and `createStockItem` wrappers**

In `src/lib/rpc.ts`, replace the `createParty` and `createStockItem` entries with:

```ts
  createParty: (
    orgId: string, name: string, kind: string,
    phone?: string, gstin?: string, stateCode?: string,
    details: Record<string, unknown> = {},
    opening?: { amount: number; type: 'dr' | 'cr'; date: string },
  ) =>
    callRpc<string>('create_party', {
      p_org: orgId, p_name: name, p_kind: kind, p_phone: phone ?? null,
      p_gstin: gstin ?? null, p_state_code: stateCode ?? null,
      p_details: details,
      p_opening_amount: opening?.amount ?? 0,
      p_opening_type: opening?.type ?? null,
      p_opening_date: opening?.date ?? null,
    }),

  createStockItem: (
    orgId: string, name: string, itemType: number, unit: string,
    minLevel = 0, hsn?: string, gstRate = 0,
    details: Record<string, unknown> = {},
    opening?: { qty: number; rate: number; date: string },
  ) =>
    callRpc<string>('create_stock_item', {
      p_org: orgId, p_name: name, p_item_type: itemType, p_unit: unit,
      p_min_level: minLevel, p_hsn: hsn ?? null, p_gst_rate: gstRate,
      p_details: details,
      p_opening_qty: opening?.qty ?? 0,
      p_opening_rate: opening?.rate ?? 0,
      p_opening_date: opening?.date ?? null,
    }),
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (PartiesPage/ItemsPage still compile — they pass a subset of args).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/queries.ts src/lib/rpc.ts
git commit -m "feat(fe): types + rpc wrappers for richer masters"
```

---

## Task 5: Party form (progressive disclosure)

**Files:**
- Modify: `src/features/masters/PartiesPage.tsx`

- [ ] **Step 1: Replace PartiesPage with the richer form + group filter**

Replace the entire contents of `src/features/masters/PartiesPage.tsx` with:

```tsx
import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useParties } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR, rupeesToPaise } from '@/lib/money'
import { GST_STATES, stateName } from '@/lib/states'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'

const today = () => new Date().toISOString().slice(0, 10)
const maskAadhaar = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 12)
  return d.length <= 4 ? d : 'XXXX XXXX ' + d.slice(-4)
}

export function PartiesPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const { data: parties = [] } = useParties(currentOrgId)

  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [groupFilter, setGroupFilter] = useState('')

  const [name, setName] = useState('')
  const [kind, setKind] = useState<'customer' | 'supplier' | 'both'>('customer')
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('')
  // more
  const [alias, setAlias] = useState('')
  const [group, setGroup] = useState('')
  const [area, setArea] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [billing, setBilling] = useState('')
  const [sameShip, setSameShip] = useState(true)
  const [shipping, setShipping] = useState('')
  const [email, setEmail] = useState('')
  const [contact, setContact] = useState('')
  const [pan, setPan] = useState('')
  const [aadhaar, setAadhaar] = useState('')
  const [udyam, setUdyam] = useState('')
  const [activity, setActivity] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [creditDays, setCreditDays] = useState('')
  const [openAmt, setOpenAmt] = useState('')
  const [openType, setOpenType] = useState<'dr' | 'cr'>('dr')
  const [openDate, setOpenDate] = useState(today())

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(
    () => Array.from(new Set(parties.map((p) => p.group_name).filter(Boolean))) as string[],
    [parties],
  )
  const shown = groupFilter ? parties.filter((p) => p.group_name === groupFilter) : parties
  const groupTotal = shown.reduce((s, p) => s + Math.abs(p.balance), 0)

  const onGstin = (v: string) => {
    setGstin(v.toUpperCase())
    if (v.length >= 2 && /^\d{2}$/.test(v.slice(0, 2))) setStateCode(v.slice(0, 2))
  }

  function resetForm() {
    setName(''); setPhone(''); setGstin(''); setStateCode(''); setKind('customer')
    setAlias(''); setGroup(''); setArea(''); setCity(''); setPincode(''); setBilling('')
    setSameShip(true); setShipping(''); setEmail(''); setContact(''); setPan(''); setAadhaar('')
    setUdyam(''); setActivity(''); setCreditLimit(''); setCreditDays('')
    setOpenAmt(''); setOpenType('dr'); setOpenDate(today()); setMore(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    setBusy(true); setError(null)
    const details: Record<string, unknown> = {
      alias: alias || null, group_name: group || null, area: area || null, city: city || null,
      pincode: pincode || null, billing_address: billing || null,
      shipping_address: sameShip ? null : (shipping || null),
      email: email || null, contact_person: contact || null, pan: pan || null,
      aadhaar: aadhaar.replace(/\D/g, '') || null, udyam_no: udyam || null,
      msme_activity: activity || null,
      credit_limit: creditLimit ? rupeesToPaise(creditLimit) : 0,
      credit_days: creditDays ? Number(creditDays) : 0,
    }
    const opening = openAmt && Number(openAmt) > 0
      ? { amount: rupeesToPaise(openAmt), type: openType, date: openDate }
      : undefined
    try {
      await rpc.createParty(currentOrgId, name, kind, phone || undefined, gstin || undefined, stateCode || undefined, details, opening)
      setOpen(false); resetForm()
      qc.invalidateQueries({ queryKey: ['parties'] })
      qc.invalidateQueries({ queryKey: ['trial_balance'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Parties</h2>
        <Button onClick={() => setOpen((o) => !o)} variant={open ? 'secondary' : 'primary'}>
          {open ? 'Close' : '+ New party'}
        </Button>
      </div>

      {open && (
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Type">
                <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="customer">Customer</option>
                  <option value="supplier">Supplier</option>
                  <option value="both">Both</option>
                </Select>
              </Field>
              <Field label="Mobile"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
              <Field label="GSTIN" hint="State is auto-set from the first 2 digits.">
                <Input value={gstin} maxLength={15} onChange={(e) => onGstin(e.target.value)} placeholder="07AABCT1234E1Z5" />
              </Field>
              <Field label="State (place of supply)">
                <Select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                  <option value="">—</option>
                  {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
                </Select>
              </Field>
            </div>

            <button type="button" onClick={() => setMore((m) => !m)}
              className="flex items-center gap-1 text-sm font-medium text-brand-600">
              {more ? <ChevronDown size={16} /> : <ChevronRight size={16} />} More details
            </button>

            {more && (
              <div className="grid gap-3 rounded-xl border border-line bg-surface p-3 md:grid-cols-2">
                <Field label="Alias"><Input value={alias} onChange={(e) => setAlias(e.target.value)} /></Field>
                <Field label="Group"><Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Wholesale" /></Field>
                <Field label="Area"><Input value={area} onChange={(e) => setArea(e.target.value)} /></Field>
                <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
                <Field label="Pincode"><Input value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric" /></Field>
                <Field label="Billing address"><Input value={billing} onChange={(e) => setBilling(e.target.value)} /></Field>
                <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" /></Field>
                <Field label="Contact person"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
                <Field label="PAN"><Input value={pan} maxLength={10} onChange={(e) => setPan(e.target.value.toUpperCase())} /></Field>
                <Field label="Aadhaar" hint="Masked; optional.">
                  <Input value={maskAadhaar(aadhaar)} inputMode="numeric"
                    onChange={(e) => setAadhaar(e.target.value)} placeholder="XXXX XXXX 1234" />
                </Field>
                <Field label="Udyam No."><Input value={udyam} onChange={(e) => setUdyam(e.target.value)} /></Field>
                <Field label="MSME activity">
                  <Select value={activity} onChange={(e) => setActivity(e.target.value)}>
                    <option value="">—</option>
                    <option>Manufacturer</option><option>Trader</option><option>Service</option>
                  </Select>
                </Field>
                <Field label="Credit limit (₹)"><Input value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} inputMode="decimal" /></Field>
                <Field label="Credit days"><Input value={creditDays} onChange={(e) => setCreditDays(e.target.value)} inputMode="numeric" /></Field>
                <div className="md:col-span-2 grid grid-cols-3 gap-2">
                  <Field label="Opening balance (₹)"><Input value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} inputMode="decimal" /></Field>
                  <Field label="Dr/Cr">
                    <Select value={openType} onChange={(e) => setOpenType(e.target.value as 'dr' | 'cr')}>
                      <option value="dr">Dr (they owe)</option>
                      <option value="cr">Cr (we owe)</option>
                    </Select>
                  </Field>
                  <Field label="As on"><Input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} /></Field>
                </div>
                {!sameShip && (
                  <Field label="Shipping address"><Input value={shipping} onChange={(e) => setShipping(e.target.value)} /></Field>
                )}
                <label className="flex items-center gap-2 text-sm text-muted md:col-span-2">
                  <input type="checkbox" checked={sameShip} onChange={(e) => setSameShip(e.target.checked)} />
                  Shipping same as billing
                </label>
              </div>
            )}

            <div className="flex items-center">
              {error && <p className="text-sm text-neg">{error}</p>}
              <Button type="submit" className="ml-auto" disabled={busy}>{busy ? 'Saving…' : 'Save party'}</Button>
            </div>
          </form>
        </Card>
      )}

      {groups.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Group:</span>
          <Select className="max-w-xs" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">All</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
          {groupFilter && <span className="text-sm text-muted">Total: <span className="num">{formatINR(groupTotal)}</span></span>}
        </div>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Group</th><th>Type</th><th>City</th><th>State</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => nav(`/reports?ledger=${p.id}`)}>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-muted">{p.group_name ?? '—'}</td>
                  <td className="capitalize text-muted">{p.kind}</td>
                  <td className="text-muted">{p.city ?? '—'}</td>
                  <td className="text-muted">{stateName(p.state_code ?? undefined)}</td>
                  <td className={`r num ${p.balance > 0 ? 'text-pos' : p.balance < 0 ? 'text-neg' : ''}`}>{formatINR(Math.abs(p.balance))}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={6} className="py-6 text-center text-muted">No parties yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/masters/PartiesPage.tsx
git commit -m "feat(ui): richer party form + group filter"
```

---

## Task 6: Item form (progressive disclosure)

**Files:**
- Modify: `src/features/masters/ItemsPage.tsx`

- [ ] **Step 1: Replace ItemsPage with the richer form**

Replace the entire contents of `src/features/masters/ItemsPage.tsx` with:

```tsx
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useItems } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR, rupeesToPaise } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'

const today = () => new Date().toISOString().slice(0, 10)
const ITEM_TYPES = [
  { id: 1, label: 'Raw material' }, { id: 2, label: 'Finished good' },
  { id: 3, label: 'Consumable' }, { id: 4, label: 'Trading good' },
]
const GST_RATES = [0, 5, 12, 18, 28]

export function ItemsPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const { data: items = [] } = useItems(currentOrgId)

  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState(4)
  const [unit, setUnit] = useState('pcs')
  const [hsn, setHsn] = useState('')
  const [gst, setGst] = useState(18)
  const [min, setMin] = useState('')
  // more
  const [code, setCode] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [openQty, setOpenQty] = useState('')
  const [openRate, setOpenRate] = useState('')
  const [openDate, setOpenDate] = useState(today())

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setName(''); setHsn(''); setMin(''); setUnit('pcs'); setGst(18); setType(4)
    setCode(''); setCategory(''); setDescription(''); setSalePrice(''); setPurchasePrice('')
    setOpenQty(''); setOpenRate(''); setOpenDate(today()); setMore(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    setBusy(true); setError(null)
    const details: Record<string, unknown> = {
      item_code: code || null, category: category || null, description: description || null,
      sale_price: salePrice ? rupeesToPaise(salePrice) : 0,
      purchase_price: purchasePrice ? rupeesToPaise(purchasePrice) : 0,
    }
    const opening = openQty && Number(openQty) > 0
      ? { qty: Number(openQty), rate: openRate ? rupeesToPaise(openRate) : 0, date: openDate }
      : undefined
    try {
      await rpc.createStockItem(currentOrgId, name, type, unit, Number(min || 0), hsn || undefined, gst, details, opening)
      setOpen(false); resetForm()
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['trial_balance'] })
      qc.invalidateQueries({ queryKey: ['inv_recon'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Items</h2>
        <Button onClick={() => setOpen((o) => !o)} variant={open ? 'secondary' : 'primary'}>
          {open ? 'Close' : '+ New item'}
        </Button>
      </div>

      {open && (
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(Number(e.target.value))}>
                  {ITEM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label="Unit"><Input required value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, pcs, bag…" /></Field>
              <Field label="HSN / SAC"><Input value={hsn} onChange={(e) => setHsn(e.target.value)} inputMode="numeric" /></Field>
              <Field label="GST rate">
                <Select value={gst} onChange={(e) => setGst(Number(e.target.value))}>
                  {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                </Select>
              </Field>
              <Field label="Low-stock alert at"><Input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" placeholder="0" /></Field>
            </div>

            <button type="button" onClick={() => setMore((m) => !m)}
              className="flex items-center gap-1 text-sm font-medium text-brand-600">
              {more ? <ChevronDown size={16} /> : <ChevronRight size={16} />} More details
            </button>

            {more && (
              <div className="grid gap-3 rounded-xl border border-line bg-surface p-3 md:grid-cols-2">
                <Field label="Item code / SKU / barcode"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
                <Field label="Sale price (₹)"><Input value={salePrice} onChange={(e) => setSalePrice(e.target.value)} inputMode="decimal" /></Field>
                <Field label="Purchase price (₹)"><Input value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} inputMode="decimal" /></Field>
                <Field label="Description" className="md:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
                <div className="md:col-span-2 grid grid-cols-3 gap-2">
                  <Field label="Opening qty"><Input value={openQty} onChange={(e) => setOpenQty(e.target.value)} inputMode="decimal" /></Field>
                  <Field label="Opening rate (₹)"><Input value={openRate} onChange={(e) => setOpenRate(e.target.value)} inputMode="decimal" /></Field>
                  <Field label="As on"><Input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} /></Field>
                </div>
              </div>
            )}

            <div className="flex items-center">
              {error && <p className="text-sm text-neg">{error}</p>}
              <Button type="submit" className="ml-auto" disabled={busy}>{busy ? 'Saving…' : 'Save item'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Item</th><th>Code</th><th>HSN</th><th className="r">GST</th><th className="r">In stock</th><th className="r">Avg cost</th><th className="r">Stock value</th></tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const low = it.qty_on_hand <= it.min_level && it.min_level > 0
                return (
                  <tr key={it.id}>
                    <td className="font-medium">{it.name}<span className="ml-1 text-xs text-muted">({it.unit})</span></td>
                    <td className="num text-muted">{it.item_code ?? '—'}</td>
                    <td className="num text-muted">{it.hsn ?? '—'}</td>
                    <td className="r num text-muted">{it.gst_rate}%</td>
                    <td className={`r num ${low ? 'text-warn' : ''}`}>{it.qty_on_hand}{low ? ' ⚠' : ''}</td>
                    <td className="r num">{formatINR(it.avg_cost, false)}</td>
                    <td className="r num">{formatINR(it.value_on_hand, false)}</td>
                  </tr>
                )
              })}
              {!items.length && <tr><td colSpan={7} className="py-6 text-center text-muted">No items yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
```

> Note: `Field` accepts a `className` prop in this codebase (used as `md:col-span-2`). If `tsc` reports `className` is not a valid `Field` prop, wrap that field in a `<div className="md:col-span-2">` instead.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/masters/ItemsPage.tsx
git commit -m "feat(ui): richer item form"
```

---

## Task 7: Default-price prefill + credit-limit warning

**Files:**
- Modify: `src/components/ItemLines.tsx`
- Modify: `src/features/sales/SalesPage.tsx`
- Modify: `src/features/purchases/PurchasesPage.tsx`

- [ ] **Step 1: Add price prefill to ItemLines**

In `src/components/ItemLines.tsx`, add a `priceField` prop and prefill the rate when an item is chosen.

Change the component signature/props to:

```tsx
export function ItemLines({
  items, value, onChange, rateLabel, priceField,
}: {
  items: Item[]
  value: Line[]
  onChange: (lines: Line[]) => void
  rateLabel: string
  priceField?: 'sale_price' | 'purchase_price'
}) {
```

Replace the item `<Select>`'s `onChange` with one that prefills the rate from the chosen item's price (in rupees, since the rate input is rupees), only when the rate is currently empty:

```tsx
                <Select
                  className="h-10 flex-1"
                  value={l.stock_item_id}
                  onChange={(e) => {
                    const picked = items.find((it) => it.id === e.target.value)
                    const price = priceField && picked ? picked[priceField] : 0
                    const prefill = !l.rate && price ? String(price / 100) : l.rate
                    set(i, { stock_item_id: e.target.value, rate: prefill || '' })
                  }}
                >
```

- [ ] **Step 2: Wire sale-price prefill on Sell**

In `src/features/sales/SalesPage.tsx`, find the `<ItemLines ... rateLabel="Sale price" />` usage and add `priceField="sale_price"`:

```tsx
            <ItemLines items={items} value={lines} onChange={setLines} rateLabel="Sale price" priceField="sale_price" />
```

- [ ] **Step 3: Add the credit-limit soft warning on Sell**

In `src/features/sales/SalesPage.tsx`, compute the selected customer's limit/used and render a warning. Add after the existing `partyName` line:

```tsx
  const selectedParty = customers.find((p) => p.id === party)
  const linesTotalPaise = lines.reduce((s, l) => s + Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0')), 0)
  const overLimit =
    mode === 'credit' && selectedParty && selectedParty.credit_limit > 0 &&
    selectedParty.balance + linesTotalPaise > selectedParty.credit_limit
```

Then render the warning just above the submit button (before `{error && ...}`):

```tsx
            {overLimit && (
              <p className="text-sm text-warn">
                ⚠ This sale puts {selectedParty!.name} over their credit limit
                ({formatINR(selectedParty!.credit_limit)}). You can still save.
              </p>
            )}
```

(Ensure `rupeesToPaise` and `formatINR` are imported — `formatINR` already is; `rupeesToPaise` already is in SalesPage.)

- [ ] **Step 4: Wire purchase-price prefill on Buy**

In `src/features/purchases/PurchasesPage.tsx`, find the `<ItemLines ... />` usage and add `priceField="purchase_price"` (keep its existing `rateLabel`).

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/ItemLines.tsx src/features/sales/SalesPage.tsx src/features/purchases/PurchasesPage.tsx
git commit -m "feat(ui): default-price prefill + credit-limit warning"
```

---

## Task 8: Verify + finish

**Files:** none

- [ ] **Step 1: Full DB test sweep**

Run (DATABASE_URL exported):
```bash
node scripts/test-masters.mjs
node scripts/smoke-test.mjs
node scripts/test-phase2.mjs
node scripts/test-manufacture.mjs
```
Expected: all `0 failed`.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual check (dev server)**

`npm run dev`. Add a party with full details + opening balance; confirm it appears, the group filter works, and the dashboard receivables reflect the opening balance. Add an item with opening stock; confirm Stock shows it and the reconciliation card stays **Matched ✓**. On Sell, pick that item and confirm the rate prefills; exceed a customer's credit limit and confirm the soft warning shows but still saves.

- [ ] **Step 4: Mobile check**

At 360px width, confirm both forms show core fields first and "More details" expands cleanly.

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide merge/PR/cleanup for `feature/richer-masters`.

---

## Self-review notes (author)

- **Spec coverage:** party fields + schema (Task 2, 5) ✓; item fields + schema (Task 2, 6) ✓; group/alias as metadata, ledger parent unchanged (Task 2 create_party keeps `parent_id`; Task 1 asserts it) ✓; opening balance/stock as real vouchers (Task 2) ✓; backward-compatible RPCs via drop+recreate with defaults (Task 2; Task 1 backward-compat checks) ✓; aadhaar not in audit (Task 2 audit line; Task 1 assert) ✓; v_parties exposes group/city/credit (Task 2, 4) ✓; default-price prefill (Task 7) ✓; credit-limit soft warning (Task 7) ✓; group filter + subtotal (Task 5) ✓; regression gate (Task 3) ✓; progressive disclosure UI (Task 5, 6) ✓.
- **Type consistency:** `Party` gains `group_name, city, credit_limit, credit_days`; `Item` gains `item_code, category, description, sale_price, purchase_price` — used consistently in PartiesPage/ItemsPage/ItemLines/SalesPage. RPC `p_details` keys match the SQL `p_details->>'…'` reads exactly (alias, group_name, area, city, pincode, billing_address, shipping_address, email, contact_person, pan, aadhaar, udyam_no, msme_activity, credit_limit, credit_days / item_code, category, description, sale_price, purchase_price).
- **Flagged assumption:** `Field` supporting a `className` prop (Task 6 note gives the fallback if not).
```
