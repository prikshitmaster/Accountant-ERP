# Manufacture (BOM RM→FG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ad-hoc `manufacture` RPC (and UI) that consumes raw materials and produces finished goods, keeping the general ledger and perpetual inventory in exact agreement.

**Architecture:** `manufacture` is a new `SECURITY DEFINER` wrapper over the existing `post_voucher` (voucher type `STOCK_JOURNAL`=9), mirroring `sell`/`purchase`. Finished-good cost = rolled-up value of materials consumed (moving weighted average), allocated across outputs by a user-supplied cost weight, with the last output absorbing the rounding remainder so the books reconcile to the paise. One guarded, backward-compatible change to `post_voucher` (an optional `value_change` override on stock lines) plus an exactness fix to `cancel_voucher`.

**Tech Stack:** PostgreSQL (plpgsql RPC, migrations in `supabase/migrations/`), Node `pg` test scripts (transactional + rollback), React + TypeScript + Tailwind + TanStack Query frontend.

**Reference spec:** `docs/superpowers/specs/2026-06-02-manufacture-bom-design.md`

---

## Environment notes (read once)

- No local Postgres on this machine (WSL2/Docker disabled). Migrations and tests run against the **cloud project** using `DATABASE_URL` = the Supabase **Session-pooler** connection string.
- Apply migrations: `node scripts/run-migrations.mjs` (sends each file in `supabase/migrations` sorted, as one multi-statement query).
- Tests follow the `scripts/smoke-test.mjs` pattern: fake an authenticated user via `request.jwt.claims`, run RPCs over `pg`, assert invariants, then `ROLLBACK` so the DB is left untouched.
- PowerShell to set the env var for one command:
  `$env:DATABASE_URL="postgresql://...session-pooler..."; node scripts/test-manufacture.mjs`

## File Structure

- **Create** `supabase/migrations/0009_manufacture.sql` — re-creates `post_voucher` (with `value_change` override), re-creates `cancel_voucher` (negates recorded `value_change`), creates `manufacture`, grants execute.
- **Create** `scripts/test-manufacture.mjs` — transactional acceptance test for manufacture + cancel + reconciliation.
- **Modify** `src/lib/rpc.ts` — add `manufacture()` wrapper and error-map entries.
- **Create** `src/features/stock/ManufacturePage.tsx` — the Manufacture form (input rows + output rows + previews).
- **Modify** `src/features/stock/StockPage.tsx` — add a link/tab to the Manufacture form (or render it as a card). *(Routing/nav wiring per Task 7.)*
- **Modify** `src/App.tsx` and `src/components/AppShell.tsx` — route + nav entry for Manufacture (follow the existing pattern those files already use for Stock).

---

## Task 1: Manufacture acceptance test (write first, must fail)

**Files:**
- Test: `scripts/test-manufacture.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-manufacture.mjs` (mirrors `scripts/smoke-test.mjs` structure exactly — same auth faking, same `check` helper, same rollback):

```js
// Transactional acceptance test for manufacture (BOM RM->FG).
// Fakes an authenticated user, runs manufacture + cancel, asserts invariants,
// then ROLLS BACK so the database is left untouched.
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const uid = '22222222-2222-2222-2222-222222222222'
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
       values ($1,'authenticated','authenticated','mfg@test.local', now(), now())`, [uid])
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' })])

    const org = (await client.query(`select create_organization('Mfg Co', 4::smallint) as id`)).rows[0].id
    const sysAcc = async (k) =>
      (await client.query(`select id from accounts where org_id=$1 and system_key=$2`, [org, k])).rows[0].id
    const inv = await sysAcc('inventory')
    const cash = await sysAcc('cash')
    const itemVal = async (id) =>
      (await client.query(`select qty_on_hand::float q, avg_cost::bigint a, value_on_hand::bigint v
                           from stock_items where id=$1`, [id])).rows[0]
    const invLedger = async () =>
      Number((await client.query(
        `select coalesce(sum(debit-credit),0)::bigint b from ledger_entries where org_id=$1 and account_id=$2`,
        [org, inv])).rows[0].b)
    const stockSum = async () =>
      Number((await client.query(
        `select coalesce(sum(value_on_hand),0)::bigint v from stock_items where org_id=$1`, [org])).rows[0].v)
    const tb = async () => {
      const r = (await client.query(
        `select coalesce(sum(closing_debit),0)::bigint dr, coalesce(sum(closing_credit),0)::bigint cr
         from v_trial_balance where org_id=$1`, [org])).rows[0]
      return Number(r.dr) === Number(r.cr)
    }

    // raw materials
    const leg = (await client.query(`select create_stock_item($1,'Leg',1::smallint,'pc',0) as id`, [org])).rows[0].id
    const top = (await client.query(`select create_stock_item($1,'Top',1::smallint,'pc',0) as id`, [org])).rows[0].id
    const table = (await client.query(`select create_stock_item($1,'Table',2::smallint,'pc',0) as id`, [org])).rows[0].id
    const bran  = (await client.query(`select create_stock_item($1,'Bran',2::smallint,'kg',0) as id`, [org])).rows[0].id

    // buy 4 legs @ ₹50 and 1 top @ ₹200 (cash) so avg cost is known
    await client.query(`select purchase($1,'2026-04-10'::date,null,$2::jsonb,'cash','buy legs')`,
      [org, JSON.stringify([{ stock_item_id: leg, qty: 4, rate: 5000 }])])
    await client.query(`select purchase($1,'2026-04-10'::date,null,$2::jsonb,'cash','buy top')`,
      [org, JSON.stringify([{ stock_item_id: top, qty: 1, rate: 20000 }])])

    const stockBefore = await stockSum()           // 4*5000 + 1*20000 = 40000
    check('material in stock = ₹400', stockBefore === 40000, `got ${stockBefore}`)

    // --- manufacture: 4 legs + 1 top -> 1 table (single output) ---
    const res = (await client.query(
      `select manufacture($1,'2026-04-12'::date,$2::jsonb,$3::jsonb,'make a table') as r`,
      [org,
       JSON.stringify([{ stock_item_id: leg, qty: 4 }, { stock_item_id: top, qty: 1 }]),
       JSON.stringify([{ stock_item_id: table, qty: 1, weight: 1 }])])).rows[0].r
    check('manufacture returns voucher_no', !!res.voucher_no, JSON.stringify(res))

    const t = await itemVal(table)
    check('table value = ₹400 (rolled up)', Number(t.v) === 40000, `got ${t.v}`)
    check('table qty = 1', Number(t.q) === 1, `got ${t.q}`)
    const legAfter = await itemVal(leg)
    check('legs consumed to 0', Number(legAfter.q) === 0, `got ${legAfter.q}`)
    check('total stock value unchanged', (await stockSum()) === 40000, `got ${await stockSum()}`)
    check('inventory ledger == stock sum', (await invLedger()) === (await stockSum()),
      `ledger=${await invLedger()} stock=${await stockSum()}`)
    check('trial balance balanced after mfg', await tb())

    // --- co-product split: consume the table (₹400) -> flour(70) + bran(30) ---
    const flour = (await client.query(`select create_stock_item($1,'Flour',2::smallint,'kg',0) as id`, [org])).rows[0].id
    await client.query(
      `select manufacture($1,'2026-04-13'::date,$2::jsonb,$3::jsonb,'co-products')`,
      [org,
       JSON.stringify([{ stock_item_id: table, qty: 1 }]),
       JSON.stringify([{ stock_item_id: flour, qty: 7, weight: 70 },
                       { stock_item_id: bran,  qty: 3, weight: 30 }])])
    const fv = Number((await itemVal(flour)).v)
    const bv = Number((await itemVal(bran)).v)
    check('co-product split sums exactly to ₹400', fv + bv === 40000, `flour=${fv} bran=${bv}`)
    check('inventory ledger still == stock sum', (await invLedger()) === (await stockSum()))
    check('trial balance balanced after co-product', await tb())

    // --- zero-cost guard ---
    const free = (await client.query(`select create_stock_item($1,'Free',1::smallint,'pc',0) as id`, [org])).rows[0].id
    // give it qty but zero cost via an opening with 0 value is awkward; instead consume an item with avg 0:
    let zeroErr = false
    try {
      await client.query(`select manufacture($1,'2026-04-14'::date,$2::jsonb,$3::jsonb,'zero')`,
        [org, JSON.stringify([{ stock_item_id: free, qty: 1 }]),
              JSON.stringify([{ stock_item_id: flour, qty: 1, weight: 1 }])])
    } catch { zeroErr = true }
    check('zero-cost manufacture rejected', zeroErr)

    // --- cancel restores exactly ---
    const mfgId = (await client.query(
      `select id from vouchers where org_id=$1 and voucher_type=9 order by created_at asc limit 1`,
      [org])).rows[0].id
    await client.query(`select cancel_voucher($1,$2)`, [org, mfgId])
    check('inventory ledger == stock sum after cancel', (await invLedger()) === (await stockSum()),
      `ledger=${await invLedger()} stock=${await stockSum()}`)
    check('trial balance balanced after cancel', await tb())

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

Run: `$env:DATABASE_URL="<session-pooler-url>"; node scripts/test-manufacture.mjs`
Expected: FAIL — error like `function manufacture(...) does not exist` (the RPC isn't created yet).

- [ ] **Step 3: Commit the failing test**

```bash
git add scripts/test-manufacture.mjs
git commit -m "test: manufacture acceptance test (red)"
```

---

## Task 2: Migration — `value_change` override, `manufacture`, exact cancel

**Files:**
- Create: `supabase/migrations/0009_manufacture.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0009_manufacture.sql`. It re-creates `post_voucher` and `cancel_voucher` (with the additive changes) and creates `manufacture`.

```sql
-- =============================================================
-- Phase: Manufacture (BOM RM->FG). STOCK_JOURNAL voucher (type 9).
-- Additive, backward-compatible changes:
--   * post_voucher: stock lines may carry an explicit "value_change"
--     override (honored on BOTH inward and outward legs). Existing
--     callers never pass it, so their behaviour is unchanged.
--   * cancel_voucher: reversal negates the recorded value_change, so
--     every reversal restores the exact original value.
--   * manufacture(): new wrapper.
-- =============================================================

-- ---------- post_voucher (re-created with value_change override) ----------
create or replace function post_voucher(
  p_org uuid, p_type smallint, p_date date, p_party uuid,
  p_narration text, p_lines jsonb, p_stock jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_lock date;
  v_fy_start smallint;
  v_fy int;
  v_code text;
  v_fy_label text;
  v_seq int;
  v_voucher_no text;
  v_voucher_id uuid;
  v_sum_dr bigint := 0;
  v_sum_cr bigint := 0;
  line jsonb;
  st jsonb;
  v_item stock_items%rowtype;
  v_qty numeric(18,4);
  v_unit_cost bigint;
  v_value_change bigint;
  v_new_qty numeric(18,4);
  v_new_value bigint;
  v_new_avg bigint;
  v_policy text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_role := org_role(p_org);
  if v_role is null then raise exception 'not_member'; end if;

  select lock_upto into v_lock from period_locks where org_id = p_org;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'period_locked';
  end if;

  for line in select * from jsonb_array_elements(p_lines) loop
    v_sum_dr := v_sum_dr + coalesce((line->>'debit')::bigint, 0);
    v_sum_cr := v_sum_cr + coalesce((line->>'credit')::bigint, 0);
  end loop;
  if v_sum_dr <> v_sum_cr then
    raise exception 'unbalanced_voucher (dr=% cr=%)', v_sum_dr, v_sum_cr;
  end if;
  if v_sum_dr = 0 then raise exception 'empty_voucher'; end if;

  select fy_start_month into v_fy_start from organizations where id = p_org;
  v_fy := case when extract(month from p_date) >= v_fy_start
               then extract(year from p_date)::int
               else extract(year from p_date)::int - 1 end;
  select code into v_code from voucher_types where id = p_type;
  v_fy_label := v_fy::text || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0');

  insert into voucher_sequences (org_id, voucher_type, fy_year, next_no)
    values (p_org, p_type, v_fy, 1)
    on conflict (org_id, voucher_type, fy_year) do nothing;
  update voucher_sequences set next_no = next_no + 1
    where org_id = p_org and voucher_type = p_type and fy_year = v_fy
    returning next_no - 1 into v_seq;

  v_voucher_no := v_code || '/' || v_fy_label || '/' || lpad(v_seq::text, 4, '0');

  insert into vouchers (org_id, voucher_type, voucher_no, date, narration, party_id, created_by)
    values (p_org, p_type, v_voucher_no, p_date, p_narration, p_party, v_uid)
    returning id into v_voucher_id;

  for line in select * from jsonb_array_elements(p_lines) loop
    insert into ledger_entries (org_id, voucher_id, account_id, party_id, debit, credit, date)
      values (p_org, v_voucher_id,
              (line->>'account_id')::uuid,
              nullif(line->>'party_id', '')::uuid,
              coalesce((line->>'debit')::bigint, 0),
              coalesce((line->>'credit')::bigint, 0),
              p_date);
  end loop;

  -- stock movements (Moving Weighted Average; optional value_change override)
  select negative_stock_policy into v_policy from org_settings where org_id = p_org;
  for st in select * from jsonb_array_elements(coalesce(p_stock, '[]'::jsonb)) loop
    select * into v_item from stock_items
      where id = (st->>'stock_item_id')::uuid and org_id = p_org for update;
    if not found then raise exception 'unknown_stock_item'; end if;

    v_qty := (st->>'qty_change')::numeric;

    if st ? 'value_change' then
      -- explicit value override (used by manufacture / exact reversals)
      v_value_change := (st->>'value_change')::bigint;
      v_new_qty      := v_item.qty_on_hand + v_qty;
      if v_qty < 0 and v_new_qty < 0 and v_policy = 'block' then
        raise exception 'negative_stock_blocked';
      end if;
      v_new_value    := v_item.value_on_hand + v_value_change;
      if v_qty >= 0 then
        v_unit_cost := case when v_qty <> 0 then round(v_value_change / v_qty) else 0 end;
        v_new_avg   := case when v_new_qty <> 0 then round(v_new_value / v_new_qty) else 0 end;
      else
        v_unit_cost := v_item.avg_cost;
        v_new_avg   := v_item.avg_cost;            -- avg unchanged on outward
      end if;
    elsif v_qty >= 0 then
      -- inward at given unit cost
      v_unit_cost    := coalesce((st->>'unit_cost')::bigint, 0);
      v_value_change := round(v_qty * v_unit_cost);
      v_new_qty      := v_item.qty_on_hand + v_qty;
      v_new_value    := v_item.value_on_hand + v_value_change;
      v_new_avg      := case when v_new_qty <> 0 then round(v_new_value / v_new_qty) else 0 end;
    else
      -- outward at current average cost
      v_unit_cost    := v_item.avg_cost;
      v_value_change := round(v_qty * v_item.avg_cost);   -- negative
      v_new_qty      := v_item.qty_on_hand + v_qty;
      if v_new_qty < 0 and v_policy = 'block' then
        raise exception 'negative_stock_blocked';
      end if;
      v_new_value    := v_item.value_on_hand + v_value_change;
      v_new_avg      := v_item.avg_cost;                  -- unchanged on outward
    end if;
    if v_new_qty = 0 then v_new_value := 0; end if;

    update stock_items
      set qty_on_hand = v_new_qty, value_on_hand = v_new_value, avg_cost = v_new_avg
      where id = v_item.id;

    insert into stock_movements
      (org_id, stock_item_id, voucher_id, date, qty_change, unit_cost,
       value_change, balance_qty, balance_value, reason)
    values
      (p_org, v_item.id, v_voucher_id, p_date, v_qty, v_unit_cost,
       v_value_change, v_new_qty, v_new_value, st->>'reason');
  end loop;

  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, v_uid, 'POST_VOUCHER', 'voucher', v_voucher_id,
            jsonb_build_object('voucher_no', v_voucher_no, 'type', p_type));

  return jsonb_build_object('voucher_id', v_voucher_id, 'voucher_no', v_voucher_no);
end; $$;

-- ---------- cancel_voucher (re-created: exact value reversal) ----------
create or replace function cancel_voucher(p_org uuid, p_voucher uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  v_v vouchers%rowtype;
  v_lock date;
  v_lines jsonb := '[]'::jsonb;
  v_stock jsonb := '[]'::jsonb;
  le record; mv record;
  v_res jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner','accountant') then raise exception 'forbidden_role'; end if;

  select * into v_v from vouchers where id = p_voucher and org_id = p_org;
  if not found then raise exception 'voucher_not_found'; end if;
  if v_v.status <> 'posted' then raise exception 'already_cancelled'; end if;

  select lock_upto into v_lock from period_locks where org_id = p_org;
  if v_lock is not null and v_v.date <= v_lock then raise exception 'period_locked'; end if;

  for le in select * from ledger_entries where voucher_id = p_voucher loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', le.account_id, 'party_id', le.party_id,
      'debit', le.credit, 'credit', le.debit));
  end loop;

  -- negate each original movement, restoring the EXACT recorded value
  for mv in select * from stock_movements where voucher_id = p_voucher loop
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', mv.stock_item_id, 'qty_change', (-mv.qty_change),
      'value_change', (-mv.value_change), 'reason', 'Reversal'));
  end loop;

  v_v.status := 'cancelled';
  update vouchers set status = 'cancelled' where id = p_voucher;

  v_res := post_voucher(p_org, v_v.voucher_type, v_v.date, v_v.party_id,
                        'Reversal of ' || v_v.voucher_no, v_lines, v_stock);
  update vouchers set reverses_id = p_voucher where id = (v_res->>'voucher_id')::uuid;

  update invoices set outstanding = total where voucher_id = p_voucher;
  update bills     set outstanding = total where voucher_id = p_voucher;
  delete from allocations where payment_voucher_id = p_voucher;

  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
    values (p_org, auth.uid(), 'CANCEL_VOUCHER', 'voucher', p_voucher,
            jsonb_build_object('reversal', v_res->>'voucher_no'));
  return v_res;
end; $$;

-- ---------- manufacture (BOM RM->FG) ----------
-- p_inputs : [{stock_item_id, qty}]            consumed at current avg cost
-- p_outputs: [{stock_item_id, qty, weight}]    produced; cost split by weight
create or replace function manufacture(
  p_org uuid, p_date date, p_inputs jsonb, p_outputs jsonb,
  p_narration text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb;
  v_item stock_items%rowtype;
  v_qty numeric(18,4);
  v_weight numeric;
  v_total_rm bigint := 0;
  v_total_weight numeric := 0;
  v_running bigint := 0;
  v_alloc bigint;
  v_n int;
  v_i int := 0;
  v_inv uuid := sys_account(p_org, 'inventory');
  v_lines jsonb;
  v_stock jsonb := '[]'::jsonb;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_inputs, '[]'::jsonb)) = 0
     or jsonb_array_length(coalesce(p_outputs, '[]'::jsonb)) = 0 then
    raise exception 'empty_voucher';
  end if;

  -- inputs: consume at current avg cost
  for it in select * from jsonb_array_elements(p_inputs) loop
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid_quantity'; end if;
    select * into v_item from stock_items
      where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_total_rm := v_total_rm + round(v_qty * v_item.avg_cost);
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', -v_qty, 'reason', 'Manufacture: consume'));
  end loop;

  if v_total_rm <= 0 then raise exception 'zero_cost_manufacture'; end if;

  -- total weight (validate)
  for it in select * from jsonb_array_elements(p_outputs) loop
    v_weight := (it->>'weight')::numeric;
    if v_weight is null or v_weight <= 0 then raise exception 'invalid_weight'; end if;
    v_total_weight := v_total_weight + v_weight;
  end loop;

  -- outputs: allocate total RM value by weight; last output absorbs remainder
  v_n := jsonb_array_length(p_outputs);
  for it in select * from jsonb_array_elements(p_outputs) loop
    v_i := v_i + 1;
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid_quantity'; end if;
    if not exists (select 1 from stock_items
                   where id = (it->>'stock_item_id')::uuid and org_id = p_org) then
      raise exception 'unknown_stock_item';
    end if;
    v_weight := (it->>'weight')::numeric;
    if v_i < v_n then
      v_alloc := round(v_total_rm * v_weight / v_total_weight);
      v_running := v_running + v_alloc;
    else
      v_alloc := v_total_rm - v_running;        -- exact conservation
    end if;
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', it->>'stock_item_id', 'qty_change', v_qty,
      'value_change', v_alloc, 'reason', 'Manufacture: produce'));
  end loop;

  -- ledger: Dr Inventory / Cr Inventory (same account, net-zero, balanced)
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_inv, 'debit', v_total_rm, 'credit', 0),
    jsonb_build_object('account_id', v_inv, 'debit', 0, 'credit', v_total_rm));

  return post_voucher(p_org, 9::smallint, p_date, null, p_narration, v_lines, v_stock);
end; $$;

grant execute on function manufacture(uuid, date, jsonb, jsonb, text) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `$env:DATABASE_URL="<session-pooler-url>"; node scripts/run-migrations.mjs`
Expected: completes with no error (re-creates the three functions on the cloud project).

- [ ] **Step 3: Run the manufacture test to verify it passes**

Run: `$env:DATABASE_URL="<session-pooler-url>"; node scripts/test-manufacture.mjs`
Expected: `N passed, 0 failed` — including the two reconciliation checks, the co-product split, the zero-cost guard, and the cancel-restore checks.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0009_manufacture.sql
git commit -m "feat(db): manufacture RPC + value_change override + exact cancel"
```

---

## Task 3: Regression — existing acceptance tests still pass

**Files:** none (runs existing `scripts/smoke-test.mjs` and `scripts/test-phase2.mjs`)

- [ ] **Step 1: Run the Phase 1 smoke test**

Run: `$env:DATABASE_URL="<session-pooler-url>"; node scripts/smoke-test.mjs`
Expected: `N passed, 0 failed` (proves the `post_voucher` change did not affect sell/purchase/expense/COGS or weighted-average behaviour for callers that don't pass `value_change`).

- [ ] **Step 2: Run the Phase 2 test (sell/purchase/payments/cancel)**

Run: `$env:DATABASE_URL="<session-pooler-url>"; node scripts/test-phase2.mjs`
Expected: `N passed, 0 failed` (proves `cancel_voucher`'s new exact-reversal path still restores sell/purchase stock and balances correctly).

> If either regression fails, STOP and fix `0009_manufacture.sql` before continuing — this is the "don't break critical work" gate. Re-run Task 2 Step 3 and this task until all three suites are green.

- [ ] **Step 3: Commit (only if a fix was needed)**

```bash
git add supabase/migrations/0009_manufacture.sql
git commit -m "fix(db): keep sell/purchase/cancel regression green"
```

---

## Task 4: Frontend RPC wrapper

**Files:**
- Modify: `src/lib/rpc.ts`

- [ ] **Step 1: Add error-map entries**

In `src/lib/rpc.ts`, add these keys to the `ERROR_MAP` object (after `voucher_not_found` / `already_cancelled`):

```ts
  zero_cost_manufacture: 'The materials consumed have no cost — set their cost first.',
  invalid_quantity: 'Quantities must be greater than zero.',
  invalid_weight: 'Each finished good needs a cost weight greater than zero.',
```

- [ ] **Step 2: Add the `manufacture` wrapper**

In `src/lib/rpc.ts`, inside the `rpc` object (after `purchase`), add:

```ts
  manufacture: (
    orgId: string,
    date: string,
    inputs: { stock_item_id: string; qty: number }[],
    outputs: { stock_item_id: string; qty: number; weight: number }[],
    narration?: string,
  ) =>
    callRpc<{ voucher_no: string }>('manufacture', {
      p_org: orgId, p_date: date, p_inputs: inputs, p_outputs: outputs,
      p_narration: narration ?? null,
    }),
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rpc.ts
git commit -m "feat(rpc): manufacture wrapper + error map"
```

---

## Task 5: Manufacture form component

**Files:**
- Create: `src/features/stock/ManufacturePage.tsx`

- [ ] **Step 1: Write the component**

Create `src/features/stock/ManufacturePage.tsx`. It uses the existing hooks/components (`useItems`, `Card`, `Button`, `Field`, `Select`, `Input`, `formatINR`) and the new `rpc.manufacture`. Inputs are item+qty (shows read-only material cost from `avg_cost`); outputs are item+qty+weight (shows allocated value + per-unit cost preview).

```tsx
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useItems, type Item } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'

const today = () => new Date().toISOString().slice(0, 10)

type InRow = { stock_item_id: string; qty: string }
type OutRow = { stock_item_id: string; qty: string; weight: string }
const emptyIn = (): InRow => ({ stock_item_id: '', qty: '' })
const emptyOut = (): OutRow => ({ stock_item_id: '', qty: '', weight: '1' })

export function ManufacturePage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const { data: items = [] } = useItems(currentOrgId)
  const byId = (id: string) => items.find((i: Item) => i.id === id)

  const [date, setDate] = useState(today())
  const [inputs, setInputs] = useState<InRow[]>([emptyIn()])
  const [outputs, setOutputs] = useState<OutRow[]>([emptyOut()])
  const [narration, setNarration] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // total material cost (paise) from current avg_cost
  const inCost = (r: InRow) => {
    const it = byId(r.stock_item_id)
    return it ? Math.round(Number(r.qty || 0) * Number(it.avg_cost)) : 0
  }
  const totalRm = inputs.reduce((s, r) => s + inCost(r), 0)
  const totalWeight = outputs.reduce((s, r) => s + Number(r.weight || 0), 0)
  // preview allocation (last output absorbs remainder — mirrors the RPC)
  const allocFor = (idx: number) => {
    if (totalWeight <= 0 || totalRm <= 0) return 0
    if (idx < outputs.length - 1) return Math.round(totalRm * Number(outputs[idx].weight || 0) / totalWeight)
    const prior = outputs.slice(0, -1).reduce((s, r) => s + Math.round(totalRm * Number(r.weight || 0) / totalWeight), 0)
    return totalRm - prior
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const inPayload = inputs
      .filter((r) => r.stock_item_id && Number(r.qty) > 0)
      .map((r) => ({ stock_item_id: r.stock_item_id, qty: Number(r.qty) }))
    const outPayload = outputs
      .filter((r) => r.stock_item_id && Number(r.qty) > 0)
      .map((r) => ({ stock_item_id: r.stock_item_id, qty: Number(r.qty), weight: Number(r.weight || 1) }))
    if (!inPayload.length || !outPayload.length) { setError('Add at least one input and one output.'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.manufacture(currentOrgId, date, inPayload, outPayload, narration)
      setMsg(`Saved · ${res.voucher_no}`)
      setInputs([emptyIn()]); setOutputs([emptyOut()]); setNarration('')
      ;['dashboard', 'daybook', 'items', 'stock_ledger', 'inventory_recon', 'trial_balance'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const setIn = (i: number, patch: Partial<InRow>) =>
    setInputs(inputs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const setOut = (i: number, patch: Partial<OutRow>) =>
    setOutputs(outputs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Manufacture</h2>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>

          {/* Inputs consumed */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Materials consumed</p>
            {inputs.map((r, i) => {
              const it = byId(r.stock_item_id)
              return (
                <div key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <Select className="h-10 flex-1" value={r.stock_item_id} onChange={(e) => setIn(i, { stock_item_id: e.target.value })}>
                      <option value="" disabled>Select item…</option>
                      {items.map((opt: Item) => <option key={opt.id} value={opt.id}>{opt.name} ({opt.unit})</option>)}
                    </Select>
                    <button type="button" onClick={() => setInputs(inputs.filter((_, idx) => idx !== i))} className="text-muted hover:text-neg"><Trash2 size={18} /></button>
                  </div>
                  <label className="mt-2 block text-xs text-muted">
                    Qty {it ? `(${it.unit})` : ''}
                    <Input className="h-10" inputMode="decimal" value={r.qty} onChange={(e) => setIn(i, { qty: e.target.value })} placeholder="0" />
                  </label>
                  {it && Number(r.qty) > 0 && (
                    <p className="mt-1.5 text-xs text-muted">Cost <span className="num">{formatINR(inCost(r))}</span> @ {formatINR(Number(it.avg_cost), false)}/{it.unit}</p>
                  )}
                </div>
              )
            })}
            <button type="button" onClick={() => setInputs([...inputs, emptyIn()])} className="flex items-center gap-1.5 text-sm font-medium text-brand-600"><Plus size={16} /> Add material</button>
          </div>

          {/* Outputs produced */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Finished goods produced</p>
            {outputs.map((r, i) => {
              const it = byId(r.stock_item_id)
              const alloc = allocFor(i)
              return (
                <div key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <Select className="h-10 flex-1" value={r.stock_item_id} onChange={(e) => setOut(i, { stock_item_id: e.target.value })}>
                      <option value="" disabled>Select item…</option>
                      {items.map((opt: Item) => <option key={opt.id} value={opt.id}>{opt.name} ({opt.unit})</option>)}
                    </Select>
                    <button type="button" onClick={() => setOutputs(outputs.filter((_, idx) => idx !== i))} className="text-muted hover:text-neg"><Trash2 size={18} /></button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs text-muted">Qty {it ? `(${it.unit})` : ''}
                      <Input className="h-10" inputMode="decimal" value={r.qty} onChange={(e) => setOut(i, { qty: e.target.value })} placeholder="0" />
                    </label>
                    <label className="text-xs text-muted">Cost weight
                      <Input className="h-10" inputMode="decimal" value={r.weight} onChange={(e) => setOut(i, { weight: e.target.value })} placeholder="1" />
                    </label>
                  </div>
                  {it && Number(r.qty) > 0 && alloc > 0 && (
                    <p className="mt-1.5 text-xs text-muted">Value <span className="num">{formatINR(alloc)}</span> · {formatINR(Math.round(alloc / Number(r.qty)), false)}/{it.unit}</p>
                  )}
                </div>
              )
            })}
            <button type="button" onClick={() => setOutputs([...outputs, emptyOut()])} className="flex items-center gap-1.5 text-sm font-medium text-brand-600"><Plus size={16} /> Add finished good</button>
          </div>

          <div className="flex justify-between border-t border-line pt-2 text-sm">
            <span className="text-muted">Total material cost</span>
            <span className="num font-medium">{formatINR(totalRm)}</span>
          </div>

          <Field label="Note (optional)"><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
          {error && <p className="text-sm text-neg">{error}</p>}
          {msg && <p className="text-sm text-pos">{msg}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Record manufacture'}</Button>
        </form>
      </Card>
    </div>
  )
}
```

> **Before writing this file, confirm two things in the codebase and adjust the code to match if they differ:**
> 1. `useItems`'s `Item` type exposes `avg_cost` and `unit` (check `src/hooks/queries.ts`). If `avg_cost` is named differently, use that name.
> 2. The TanStack Query keys used by `qc.invalidateQueries` (`stock_ledger`, `inventory_recon`, etc.) match the actual `queryKey`s in `src/hooks/queries.ts`. Use the real key strings.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/stock/ManufacturePage.tsx
git commit -m "feat(ui): manufacture form"
```

---

## Task 6: Wire route + navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/features/stock/StockPage.tsx`

- [ ] **Step 1: Read the existing routing/nav pattern**

Open `src/App.tsx` and `src/components/AppShell.tsx`. Find how the existing **Stock** route and nav entry are declared (the import of `StockPage`, its `<Route>`, and its nav item). Replicate that exact pattern for `ManufacturePage` at path `/manufacture`.

- [ ] **Step 2: Add the route**

In `src/App.tsx`: import `ManufacturePage` from `@/features/stock/ManufacturePage` and add a `<Route path="manufacture" element={<ManufacturePage />} />` alongside the Stock route (match the surrounding JSX exactly).

- [ ] **Step 3: Add a way to reach it**

Either add a nav entry in `src/components/AppShell.tsx` mirroring the Stock entry, **or** (lighter touch) add a link button at the top of `src/features/stock/StockPage.tsx`:

```tsx
import { Link } from 'react-router-dom'
// ...inside the header, next to the <h2>:
<Link to="/manufacture" className="text-sm font-medium text-brand-600">+ Manufacture</Link>
```

Pick whichever matches the app's existing navigation density; if Stock has a nav entry, give Manufacture one too.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds (no TS or bundler errors).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/AppShell.tsx src/features/stock/StockPage.tsx
git commit -m "feat(ui): route + nav for manufacture"
```

---

## Task 7: Manual verification + finish

**Files:** none

- [ ] **Step 1: Run the app and exercise the flow**

Run: `npm run dev`. Sign in to a demo org (use `scripts/seed-demo.mjs` data if needed). Buy some raw materials, open **Manufacture**, consume them into a finished good, Save, and confirm:
- success toast shows the voucher number,
- the finished good appears in **Stock** with the rolled-up value,
- the **Reconciliation** card on StockPage still says **Matched ✓**,
- the Stock Journal appears in **Day Book** and the item **Stock Ledger**.

- [ ] **Step 2: Mobile check**

In dev tools at 360px width, confirm the Manufacture form is single-column, tap targets are comfortable, and the Save button is reachable.

- [ ] **Step 3: Full test sweep**

Run all three test scripts once more to confirm green end-to-end:
`node scripts/test-manufacture.mjs`, `node scripts/smoke-test.mjs`, `node scripts/test-phase2.mjs`
Expected: all `0 failed`.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide merge/PR/cleanup for `feature/manufacture-bom`.

---

## Self-review notes (author)

- **Spec coverage:** ad-hoc inputs/outputs (Task 2, 5) ✓; material-only cost (Task 2 `v_total_rm`) ✓; cost-weight allocation with remainder-on-last (Task 2 outputs loop, Task 5 `allocFor`) ✓; `value_change` engine override (Task 2 post_voucher) ✓; error codes (Task 2 raises + Task 4 map) ✓; cancellation exactness (Task 2 cancel_voucher + Task 1 cancel checks) ✓; frontend sheet (Task 5/6) ✓; tests incl. regression (Task 1/3) ✓.
- **Type consistency:** RPC param names (`p_inputs`,`p_outputs`,`p_org`,`p_date`,`p_narration`) match between SQL (Task 2), wrapper (Task 4), and component call (Task 5). `manufacture` grant signature `(uuid, date, jsonb, jsonb, text)` matches the function.
- **Known assumption flagged for the implementer:** the exact `Item` field name for average cost and the TanStack query keys must be verified against `src/hooks/queries.ts` (noted in Task 5).
```
