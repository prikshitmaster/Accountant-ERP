// Seeds a realistic demo organisation under the a@a.co user (idempotent).
//   DATABASE_URL=... node scripts/seed-demo.mjs
import pg from 'pg'
const url = process.env.DATABASE_URL
const USER_EMAIL = process.env.EMAIL || 'a@a.co'
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const q = (sql, args) => client.query(sql, args)
const one = async (sql, args) => (await q(sql, args)).rows[0]
const ORG_NAME = 'Demo Traders'

const run = async () => {
  await client.connect()
  const u = await one(`select id from auth.users where email=$1`, [USER_EMAIL])
  if (!u) { console.error(`No user ${USER_EMAIL}; run create-user.mjs first`); process.exit(1) }
  const uid = u.id

  // idempotent: drop prior demo org (cascades)
  await q(`delete from organizations where name=$1 and id in (select org_id from memberships where user_id=$2)`, [ORG_NAME, uid])
  await q(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: uid })])

  const org = (await one(`select create_organization($1,4::smallint) id`, [ORG_NAME])).id
  await q(`update org_settings set gstin='07AABCT1234E1Z5', state_code='07', owner_name='Demo Owner' where org_id=$1`, [org])

  // parties (Delhi = 07 intra; others inter-state)
  const cust1 = (await one(`select create_party($1,'Rajesh Hardware','customer','9810011111','07AAACR1111A1Z2','07') id`, [org])).id
  const cust2 = (await one(`select create_party($1,'Mumbai Mega Mart','customer','9820022222','27AAACM2222B1Z3','27') id`, [org])).id
  const cust3 = (await one(`select create_party($1,'Sharma Builders','customer','9890033333','29AAACS3333C1Z4','29') id`, [org])).id
  const sup1  = (await one(`select create_party($1,'Bharat Steel Co','supplier','9811044444','07AAACB4444D1Z5','07') id`, [org])).id
  const sup2  = (await one(`select create_party($1,'Gujarat Cement Ltd','supplier','9824055555','24AAACG5555E1Z6','24') id`, [org])).id

  // items
  const tmt   = (await one(`select create_stock_item($1,'TMT Steel Bar 12mm',1::smallint,'kg',500,'7214',18) id`, [org])).id
  const cement= (await one(`select create_stock_item($1,'Cement Bag 50kg',4::smallint,'bag',50,'2523',28) id`, [org])).id
  const pipe  = (await one(`select create_stock_item($1,'GI Pipe 1 inch',4::smallint,'pcs',20,'7306',18) id`, [org])).id
  const paint = (await one(`select create_stock_item($1,'Wall Paint 20L',4::smallint,'bucket',10,'3208',18) id`, [org])).id

  // opening balances: cash ₹2,00,000 + bank ₹8,00,000
  await q(`select opening_balances($1,$2::jsonb,'[]'::jsonb)`, [org, JSON.stringify([
    { account_id: (await sys(org,'cash')), debit: 20000000, credit: 0 },
    { account_id: (await sys(org,'bank')), debit: 80000000, credit: 0 },
  ])])

  // purchases (credit) — build stock. rate = paise/unit
  await q(`select purchase($1,'2026-04-03'::date,$2,$3::jsonb,'credit','Opening stock buy')`, [org, sup1, JSON.stringify([
    { stock_item_id: tmt, qty: 2000, rate: 5500 },   // ₹55/kg
    { stock_item_id: pipe, qty: 200, rate: 28000 },  // ₹280/pc
  ])])
  await q(`select purchase($1,'2026-04-04'::date,$2,$3::jsonb,'credit','Cement + paint')`, [org, sup2, JSON.stringify([
    { stock_item_id: cement, qty: 300, rate: 38000 },// ₹380/bag (inter, IGST)
    { stock_item_id: paint, qty: 60, rate: 240000 }, // ₹2400/bucket
  ])])

  // sales
  await q(`select sell($1,'2026-04-08'::date,$2,$3::jsonb,'credit','Site order')`, [org, cust1, JSON.stringify([
    { stock_item_id: tmt, qty: 500, rate: 6200 }, { stock_item_id: cement, qty: 80, rate: 42000 },
  ])])
  await q(`select sell($1,'2026-04-14'::date,$2,$3::jsonb,'credit','Bulk order')`, [org, cust2, JSON.stringify([
    { stock_item_id: pipe, qty: 60, rate: 32000 }, { stock_item_id: paint, qty: 15, rate: 280000 },
  ])])
  await q(`select sell($1,'2026-04-20'::date,$2,$3::jsonb,'credit','Project supply')`, [org, cust3, JSON.stringify([
    { stock_item_id: tmt, qty: 300, rate: 6300 },
  ])])
  await q(`select sell($1,'2026-05-02'::date,null,$2::jsonb,'cash','Counter sale')`, [org, JSON.stringify([
    { stock_item_id: paint, qty: 3, rate: 290000 }, { stock_item_id: cement, qty: 10, rate: 43000 },
  ])])

  // receipts (partial) and payments
  const invC1 = (await one(`select id, total from invoices where org_id=$1 and party_id=$2 order by date limit 1`, [org, cust1]))
  await q(`select receive_payment($1,'2026-05-06'::date,$2,$3::bigint,'bank',$4::jsonb,'Part payment')`,
    [org, cust1, Math.round(invC1.total * 0.6), JSON.stringify([{ invoice_id: invC1.id, amount: Math.round(invC1.total * 0.6) }])])
  const billS1 = (await one(`select id, total from bills where org_id=$1 and party_id=$2 order by date limit 1`, [org, sup1]))
  await q(`select make_payment($1,'2026-05-10'::date,$2,$3::bigint,'bank',$4::jsonb,'Supplier payment')`,
    [org, sup1, billS1.total, JSON.stringify([{ bill_id: billS1.id, amount: billS1.total }])])

  // expenses
  await q(`select expense($1,'2026-04-30'::date,$2,4500000::bigint,'bank',null,'April rent')`, [org, await acc(org,'Rent')])
  await q(`select expense($1,'2026-05-05'::date,$2,1280000::bigint,'cash',null,'Electricity bill')`, [org, await acc(org,'Electricity')])
  await q(`select expense($1,'2026-05-15'::date,$2,8500000::bigint,'bank',null,'Staff salaries')`, [org, await acc(org,'Salaries & Wages')])

  await client.end()
  console.log(`Seeded "${ORG_NAME}" for ${USER_EMAIL}.`)

  async function sys(o, k) { return (await one(`select id from accounts where org_id=$1 and system_key=$2`, [o, k])).id }
  async function acc(o, n) { return (await one(`select id from accounts where org_id=$1 and name=$2`, [o, n])).id }
}
run().catch((e) => { console.error(e.message); process.exit(1) })
