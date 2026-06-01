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
