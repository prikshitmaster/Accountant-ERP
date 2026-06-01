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
    // A failing RPC aborts the surrounding transaction, so wrap the expected
    // error in a SAVEPOINT to roll back just this statement and continue.
    const free = (await client.query(`select create_stock_item($1,'Free',1::smallint,'pc',0) as id`, [org])).rows[0].id
    let zeroErr = false
    await client.query('savepoint sp_zero')
    try {
      await client.query(`select manufacture($1,'2026-04-14'::date,$2::jsonb,$3::jsonb,'zero')`,
        [org, JSON.stringify([{ stock_item_id: free, qty: 1 }]),
              JSON.stringify([{ stock_item_id: flour, qty: 1, weight: 1 }])])
      await client.query('release savepoint sp_zero')
    } catch { zeroErr = true; await client.query('rollback to savepoint sp_zero') }
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
