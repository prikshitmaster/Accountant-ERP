// Transactional test for v_monthly_pl. Seeds sales/purchase/expense across two
// months, asserts the monthly P&L building blocks + reconciliation with the
// existing v_profit_loss, then ROLLS BACK.
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const uid = '44444444-4444-4444-4444-444444444444'
let pass = 0, fail = 0
const check = (n, c, e = '') => { if (c) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n} ${e}`) } }

const run = async () => {
  await client.connect()
  await client.query('begin')
  try {
    await client.query(`insert into auth.users (id, aud, role, email, created_at, updated_at)
      values ($1,'authenticated','authenticated','ins@test.local', now(), now())`, [uid])
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' })])

    const org = (await client.query(`select create_organization('Insights Co', 4::smallint) as id`)).rows[0].id
    const rent = (await client.query(`select id from accounts where org_id=$1 and name='Rent'`, [org])).rows[0].id

    // opening cash so cash sales/expenses have funds
    const cash = (await client.query(`select id from accounts where org_id=$1 and system_key='cash'`, [org])).rows[0].id
    await client.query(`select opening_balances($1,$2::jsonb,'[]'::jsonb)`,
      [org, JSON.stringify([{ account_id: cash, debit: 10000000, credit: 0 }])])

    // item to sell (buy 10 @ ₹100 cash, then sell 4 @ ₹250 cash) in April
    const it = (await client.query(`select create_stock_item($1,'Widget',4::smallint,'pcs',0) as id`, [org])).rows[0].id
    await client.query(`select purchase($1,'2026-04-05'::date,null,$2::jsonb,'cash','buy')`,
      [org, JSON.stringify([{ stock_item_id: it, qty: 10, rate: 10000 }])])
    await client.query(`select sell($1,'2026-04-10'::date,null,$2::jsonb,'cash','sell')`,
      [org, JSON.stringify([{ stock_item_id: it, qty: 4, rate: 25000 }])])
    await client.query(`select expense($1,'2026-04-15'::date,$2,$3::bigint,'cash',null,'rent')`,
      [org, rent, 300000])
    // May: another sale 2 @ ₹250
    await client.query(`select sell($1,'2026-05-12'::date,null,$2::jsonb,'cash','sell2')`,
      [org, JSON.stringify([{ stock_item_id: it, qty: 2, rate: 25000 }])])

    const apr = (await client.query(
      `select sales, cogs, gross_profit, income, expense, net_profit from v_monthly_pl
       where org_id=$1 and month='2026-04-01'`, [org])).rows[0]
    check('April sales = ₹1,000 (4*250)', Number(apr.sales) === 100000, `got ${apr?.sales}`)
    check('April cogs = ₹400 (4*100)', Number(apr.cogs) === 40000, `got ${apr?.cogs}`)
    check('April gross_profit = ₹600', Number(apr.gross_profit) === 60000, `got ${apr?.gross_profit}`)
    check('April net_profit = sales-cogs-rent = ₹300', Number(apr.net_profit) === 30000, `got ${apr?.net_profit}`)

    const may = (await client.query(
      `select sales, net_profit from v_monthly_pl where org_id=$1 and month='2026-05-01'`, [org])).rows[0]
    check('May sales = ₹500 (2*250)', Number(may.sales) === 50000, `got ${may?.sales}`)

    // reconcile: sum(net_profit) across months == P&L (income - expense)
    const mpl = (await client.query(
      `select coalesce(sum(net_profit),0)::bigint np from v_monthly_pl where org_id=$1`, [org])).rows[0].np
    const pl = (await client.query(
      `select coalesce(sum(case when group_id=4 then amount else -amount end),0)::bigint np
       from v_profit_loss where org_id=$1`, [org])).rows[0].np
    check('monthly net_profit reconciles with P&L', Number(mpl) === Number(pl), `monthly=${mpl} pl=${pl}`)
  } finally {
    await client.query('rollback'); await client.end()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
