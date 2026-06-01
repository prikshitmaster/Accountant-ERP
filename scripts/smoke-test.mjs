// Transactional smoke test of the Phase 1 accounting engine.
// Simulates an authenticated user via request.jwt.claims, runs core RPCs,
// asserts invariants, then ROLLS BACK so the database is left untouched.
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const uid = '11111111-1111-1111-1111-111111111111'
let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

const run = async () => {
  await client.connect()
  await client.query('begin')
  try {
    // fake authenticated user
    await client.query(
      `insert into auth.users (id, aud, role, email, created_at, updated_at)
       values ($1,'authenticated','authenticated','smoke@test.local', now(), now())`, [uid])
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' })])

    // 1) create org
    const org = (await client.query(`select create_organization('Smoke Co', 4::smallint) as id`)).rows[0].id
    check('create_organization returns id', !!org)

    // system accounts seeded
    const sysCount = (await client.query(
      `select count(*)::int n from accounts where org_id=$1 and is_system`, [org])).rows[0].n
    check('system accounts seeded', sysCount >= 12, `got ${sysCount}`)

    // 2) opening balances: cash 50,000
    await client.query(`select opening_balances($1, $2::jsonb, '[]'::jsonb)`, [
      org,
      JSON.stringify([{ account_id: (await sysAcc(org, 'cash')), debit: 5000000, credit: 0 }]),
    ])

    // 3) expense: rent 5,000 from cash
    const rent = (await client.query(
      `select id from accounts where org_id=$1 and name='Rent'`, [org])).rows[0].id
    await client.query(`select expense($1,$2::date,$3,$4::bigint,'cash',null,'June rent')`,
      [org, '2026-04-10', rent, 500000])

    // trial balance must balance
    const tb = (await client.query(
      `select coalesce(sum(closing_debit),0)::bigint dr, coalesce(sum(closing_credit),0)::bigint cr
       from v_trial_balance where org_id=$1`, [org])).rows[0]
    check('trial balance balanced (acc#3)', tb.dr === tb.cr, `dr=${tb.dr} cr=${tb.cr}`)

    // 4) moving weighted average (acc#9) + inventory==ledger (acc#5)
    const item = (await client.query(
      `select create_stock_item($1,'Steel',1::smallint,'kg',0) as id`, [org])).rows[0].id
    const inv = await sysAcc(org, 'inventory')
    const cash = await sysAcc(org, 'cash')
    const cogs = await sysAcc(org, 'cogs')
    // buy 100 @ ₹50
    await postStock(org, '2026-04-11', [
      { account_id: inv, debit: 500000, credit: 0 }, { account_id: cash, debit: 0, credit: 500000 }],
      [{ stock_item_id: item, qty_change: 100, unit_cost: 5000 }])
    // buy 100 @ ₹60
    await postStock(org, '2026-04-12', [
      { account_id: inv, debit: 600000, credit: 0 }, { account_id: cash, debit: 0, credit: 600000 }],
      [{ stock_item_id: item, qty_change: 100, unit_cost: 6000 }])
    // consume 150
    await postStock(org, '2026-04-13', [
      { account_id: cogs, debit: 825000, credit: 0 }, { account_id: inv, debit: 0, credit: 825000 }],
      [{ stock_item_id: item, qty_change: -150 }])

    const si = (await client.query(
      `select qty_on_hand::float q, avg_cost::bigint a, value_on_hand::bigint v from stock_items where id=$1`, [item])).rows[0]
    check('avg cost ₹55 (acc#9)', Number(si.a) === 5500, `got ${si.a}`)
    check('closing qty 50 (acc#9)', Number(si.q) === 50, `got ${si.q}`)
    check('closing value ₹2,750 (acc#9)', Number(si.v) === 275000, `got ${si.v}`)

    const invLedger = (await client.query(
      `select coalesce(sum(debit-credit),0)::bigint b from ledger_entries where org_id=$1 and account_id=$2`,
      [org, inv])).rows[0].b
    check('inventory ledger == value_on_hand (acc#5)', Number(invLedger) === Number(si.v), `ledger=${invLedger} item=${si.v}`)

    // 5) unbalanced voucher rejected
    let rejected = false
    try {
      await client.query(`select post_voucher($1,6::smallint,'2026-04-14'::date,null,'bad',$2::jsonb,'[]'::jsonb)`,
        [org, JSON.stringify([{ account_id: cash, debit: 100, credit: 0 }])])
    } catch { rejected = true }
    check('unbalanced voucher rejected', rejected)

  } finally {
    await client.query('rollback')
    await client.end()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)

  async function sysAcc(o, k) {
    return (await client.query(`select id from accounts where org_id=$1 and system_key=$2`, [o, k])).rows[0].id
  }
  async function postStock(o, d, lines, stock) {
    await client.query(`select post_voucher($1,6::smallint,$2::date,null,'test',$3::jsonb,$4::jsonb)`,
      [o, d, JSON.stringify(lines), JSON.stringify(stock)])
  }
}
run().catch((e) => { console.error(e); process.exit(1) })
