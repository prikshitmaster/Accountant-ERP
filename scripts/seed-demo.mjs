// Comprehensive demo seed for Demo Traders (idempotent).
// Covers: parties, items, manufacture, sales, purchases, receipts,
//         payments, expenses, contra, drawings — across Apr/May/Jun 2026.
//   DATABASE_URL=... node scripts/seed-demo.mjs
import pg from 'pg'
const url = process.env.DATABASE_URL
const USER_EMAIL = process.env.EMAIL || 'a@a.co'
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const q   = (sql, args) => client.query(sql, args)
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
  await q(`update org_settings set gstin='07AABCT1234E1Z5', state_code='07', owner_name='Demo Owner',
    address_line1='123 Industrial Area', address_line2='Okhla Phase II', city='New Delhi', pincode='110020',
    bank_name='State Bank of India', bank_account_no='00112233445566', bank_ifsc='SBIN0001234',
    upi='demotradersdelhi@okaxis' where org_id=$1`, [org])

  // ── PARTIES ──────────────────────────────────────────────────────────────
  // Customers: Delhi (intra 07), Mumbai (inter 27), Bangalore (inter 29), Hyderabad (inter 36)
  const cust1 = (await one(`select create_party($1,'Rajesh Hardware','customer','9810011111','07AAACR1111A1Z2','07') id`, [org])).id
  const cust2 = (await one(`select create_party($1,'Mumbai Mega Mart','customer','9820022222','27AAACM2222B1Z3','27') id`, [org])).id
  const cust3 = (await one(`select create_party($1,'Sharma Builders','customer','9890033333','29AAACS3333C1Z4','29') id`, [org])).id
  const cust4 = (await one(`select create_party($1,'City Construction Co','customer','9870044444','36AAACC4444D1Z5','36') id`, [org])).id
  // Suppliers
  const sup1  = (await one(`select create_party($1,'Bharat Steel Co','supplier','9811055555','07AAACB5555E1Z6','07') id`, [org])).id
  const sup2  = (await one(`select create_party($1,'Gujarat Cement Ltd','supplier','9824066666','24AAACG6666F1Z7','24') id`, [org])).id
  const sup3  = (await one(`select create_party($1,'National Paints Pvt Ltd','supplier','9822077777','27AAACN7777G1Z8','27') id`, [org])).id

  // ── ITEMS ────────────────────────────────────────────────────────────────
  // Trading goods (item_type 4)
  const tmt    = (await one(`select create_stock_item($1,'TMT Steel Bar 12mm',4::smallint,'kg',   1500,'7214',18) id`, [org])).id
  const cement = (await one(`select create_stock_item($1,'Cement Bag 50kg',   4::smallint,'bag',   250,'2523',28) id`, [org])).id
  const pipe   = (await one(`select create_stock_item($1,'GI Pipe 1 inch',    4::smallint,'pcs',    50,'7306',18) id`, [org])).id
  const paint  = (await one(`select create_stock_item($1,'Wall Paint 20L',    4::smallint,'bucket', 10,'3208',18) id`, [org])).id
  // Raw materials for manufacture (item_type 1)
  const wire   = (await one(`select create_stock_item($1,'Steel Wire Rod',    1::smallint,'kg',    100,'7213',18) id`, [org])).id
  const plate  = (await one(`select create_stock_item($1,'MS Plate 6mm',      1::smallint,'kg',     50,'7208',18) id`, [org])).id
  // Finished good produced by manufacture (item_type 2)
  const frame  = (await one(`select create_stock_item($1,'Fabricated Steel Frame',2::smallint,'pcs',6,'7308',18) id`, [org])).id

  // ── OPENING BALANCES ─────────────────────────────────────────────────────
  // Cash ₹2,00,000 + Bank ₹50,00,000 (amounts in paise)
  await q(`select opening_balances($1,$2::jsonb,'[]'::jsonb)`, [org, JSON.stringify([
    { account_id: await sys(org,'cash'), debit: 20000000,  credit: 0 },
    { account_id: await sys(org,'bank'), debit: 500000000, credit: 0 },
  ])])

  // ════════════════════════════════════════════════════════════════════════
  // APRIL 2026
  // ════════════════════════════════════════════════════════════════════════

  // Purchases (credit) — build initial stock; rate in paise/unit
  await q(`select purchase($1,'2026-04-03'::date,$2,$3::jsonb,'credit','Opening steel stock')`, [org, sup1, JSON.stringify([
    { stock_item_id: tmt,   qty: 2000, rate:  5500 },  // ₹55/kg
    { stock_item_id: wire,  qty:  500, rate:  4500 },  // ₹45/kg
    { stock_item_id: plate, qty:  200, rate:  5500 },  // ₹55/kg
    { stock_item_id: pipe,  qty:  200, rate: 28000 },  // ₹280/pc
  ])])
  await q(`select purchase($1,'2026-04-04'::date,$2,$3::jsonb,'credit','Cement + paint stock')`, [org, sup2, JSON.stringify([
    { stock_item_id: cement, qty: 300, rate:  38000 }, // ₹380/bag
  ])])
  await q(`select purchase($1,'2026-04-05'::date,$2,$3::jsonb,'credit','Paint stock')`, [org, sup3, JSON.stringify([
    { stock_item_id: paint, qty: 60, rate: 240000 },   // ₹2400/bucket
  ])])

  // Manufacture batch-1: 100 kg wire + 50 kg plate → 10 frames
  await q(`select manufacture($1,'2026-04-10'::date,$2::jsonb,$3::jsonb,'Batch-1: Steel Frames')`, [org,
    JSON.stringify([
      { stock_item_id: wire,  qty: 100 },
      { stock_item_id: plate, qty:  50 },
    ]),
    JSON.stringify([
      { stock_item_id: frame, qty: 10, weight: 100 },
    ]),
  ])

  // Sales April (credit)
  await q(`select sell($1,'2026-04-08'::date,$2,$3::jsonb,'credit','Site order',0,0)`, [org, cust1, JSON.stringify([
    { stock_item_id: tmt,    qty: 500, rate:  6200 },  // ₹62/kg
    { stock_item_id: cement, qty:  80, rate: 42000 },  // ₹420/bag
  ])])
  await q(`select sell($1,'2026-04-14'::date,$2,$3::jsonb,'credit','Bulk order',0,0)`, [org, cust2, JSON.stringify([
    { stock_item_id: pipe,  qty: 60, rate: 32000 },    // ₹320/pc
    { stock_item_id: paint, qty: 15, rate: 280000 },   // ₹2800/bucket
  ])])
  await q(`select sell($1,'2026-04-20'::date,$2,$3::jsonb,'credit','Project supply + frames',0,0)`, [org, cust3, JSON.stringify([
    { stock_item_id: tmt,   qty: 300, rate:  6300 },
    { stock_item_id: frame, qty:   5, rate: 800000 },  // ₹8000/frame
  ])])
  // Cash sale April
  await q(`select sell($1,'2026-04-25'::date,null,$2::jsonb,'cash','Counter sale',0,0)`, [org, JSON.stringify([
    { stock_item_id: paint,  qty:  3, rate: 290000 },
    { stock_item_id: cement, qty: 10, rate: 43000  },
  ])])

  // Expenses April
  await q(`select expense($1,'2026-04-30'::date,$2,4500000::bigint,'bank',null,'April rent')`,          [org, await acc(org,'Rent')])
  await q(`select expense($1,'2026-04-28'::date,$2,1280000::bigint,'cash',null,'Electricity April')`,   [org, await acc(org,'Electricity')])

  // ════════════════════════════════════════════════════════════════════════
  // MAY 2026
  // ════════════════════════════════════════════════════════════════════════

  // Collect on April invoices
  const invC1a = await one(`select id,total from invoices where org_id=$1 and party_id=$2 order by date limit 1`, [org, cust1])
  await q(`select receive_payment($1,'2026-05-05'::date,$2,$3::bigint,'bank',$4::jsonb,'Rajesh part-payment')`,
    [org, cust1, Math.round(invC1a.total * 0.6),
     JSON.stringify([{ invoice_id: invC1a.id, amount: Math.round(invC1a.total * 0.6) }])])

  const invC2a = await one(`select id,total from invoices where org_id=$1 and party_id=$2 order by date limit 1`, [org, cust2])
  await q(`select receive_payment($1,'2026-05-07'::date,$2,$3::bigint,'bank',$4::jsonb,'Mumbai full payment')`,
    [org, cust2, invC2a.total, JSON.stringify([{ invoice_id: invC2a.id, amount: invC2a.total }])])

  // Pay April bills
  const billS1a = await one(`select id,total from bills where org_id=$1 and party_id=$2 order by date limit 1`, [org, sup1])
  await q(`select make_payment($1,'2026-05-10'::date,$2,$3::bigint,'bank',$4::jsonb,'Steel Co payment')`,
    [org, sup1, billS1a.total, JSON.stringify([{ bill_id: billS1a.id, amount: billS1a.total }])])

  const billS2a = await one(`select id,total from bills where org_id=$1 and party_id=$2 order by date limit 1`, [org, sup2])
  await q(`select make_payment($1,'2026-05-12'::date,$2,$3::bigint,'bank',$4::jsonb,'Cement part-payment')`,
    [org, sup2, Math.round(billS2a.total * 0.5),
     JSON.stringify([{ bill_id: billS2a.id, amount: Math.round(billS2a.total * 0.5) }])])

  // Purchases May
  await q(`select purchase($1,'2026-05-02'::date,$2,$3::jsonb,'credit','Steel restock')`, [org, sup1, JSON.stringify([
    { stock_item_id: tmt,  qty: 500, rate: 5600 },
    { stock_item_id: wire, qty: 300, rate: 4600 },
  ])])
  await q(`select purchase($1,'2026-05-08'::date,$2,$3::jsonb,'credit','Cement restock')`, [org, sup2, JSON.stringify([
    { stock_item_id: cement, qty: 100, rate: 39000 },
  ])])

  // Manufacture batch-2: 80 kg wire + 40 kg plate → 8 frames
  await q(`select manufacture($1,'2026-05-12'::date,$2::jsonb,$3::jsonb,'Batch-2: Steel Frames')`, [org,
    JSON.stringify([
      { stock_item_id: wire,  qty: 80 },
      { stock_item_id: plate, qty: 40 },
    ]),
    JSON.stringify([
      { stock_item_id: frame, qty: 8, weight: 80 },
    ]),
  ])

  // Sales May
  await q(`select sell($1,'2026-05-06'::date,$2,$3::jsonb,'credit','Frames + pipe order',0,0)`, [org, cust4, JSON.stringify([
    { stock_item_id: frame, qty:  8, rate: 850000 },   // ₹8500/frame
    { stock_item_id: pipe,  qty: 40, rate:  33000 },
  ])])
  await q(`select sell($1,'2026-05-15'::date,$2,$3::jsonb,'credit','May steel order',0,0)`, [org, cust1, JSON.stringify([
    { stock_item_id: tmt,    qty: 400, rate: 6400 },
    { stock_item_id: cement, qty:  60, rate: 44000 },
  ])])
  // Sale with discount + freight
  await q(`select sell($1,'2026-05-22'::date,$2,$3::jsonb,'credit','May project supply',500000,200000)`, [org, cust3, JSON.stringify([
    { stock_item_id: tmt,  qty: 200, rate: 6500 },
    { stock_item_id: pipe, qty:  30, rate: 34000 },
  ])])
  // Cash sale May
  await q(`select sell($1,'2026-05-28'::date,null,$2::jsonb,'cash','Cash counter May',0,0)`, [org, JSON.stringify([
    { stock_item_id: cement, qty: 15, rate: 44000  },
    { stock_item_id: paint,  qty:  5, rate: 295000 },
  ])])

  // Contra: bank → cash (petty cash withdrawal)
  await q(`select contra($1,'2026-05-20'::date,$2,$3,2000000::bigint,'Petty cash withdrawal')`,
    [org, await sys(org,'bank'), await sys(org,'cash')])

  // Capital introduction
  await q(`select introduce_capital($1,'2026-05-01'::date,1000000000::bigint,'bank')`, [org])  // ₹10,00,000

  // Expenses May
  await q(`select expense($1,'2026-05-31'::date,$2,4500000::bigint,'bank',null,'May rent')`,           [org, await acc(org,'Rent')])
  await q(`select expense($1,'2026-05-15'::date,$2,8500000::bigint,'bank',null,'Salaries May')`,        [org, await acc(org,'Salaries & Wages')])
  await q(`select expense($1,'2026-05-25'::date,$2, 950000::bigint,'cash',null,'Electricity May')`,    [org, await acc(org,'Electricity')])

  // ════════════════════════════════════════════════════════════════════════
  // JUNE 2026
  // ════════════════════════════════════════════════════════════════════════

  // Purchases June
  await q(`select purchase($1,'2026-06-02'::date,$2,$3::jsonb,'credit','Paint + pipe restock')`, [org, sup3, JSON.stringify([
    { stock_item_id: paint, qty: 20, rate: 245000 },
    { stock_item_id: pipe,  qty: 50, rate:  29000 },
  ])])

  // Sales June
  await q(`select sell($1,'2026-06-03'::date,$2,$3::jsonb,'credit','June order Mumbai',0,0)`, [org, cust2, JSON.stringify([
    { stock_item_id: tmt,   qty: 200, rate: 6600 },
    { stock_item_id: paint, qty:   8, rate: 300000 },
  ])])
  await q(`select sell($1,'2026-06-03'::date,$2,$3::jsonb,'credit','June order Hyderabad',0,0)`, [org, cust4, JSON.stringify([
    { stock_item_id: tmt,    qty: 100, rate: 6700 },
    { stock_item_id: cement, qty:  25, rate: 45000 },
  ])])

  // Receipts June
  const invC1b = await one(`select id,total from invoices where org_id=$1 and party_id=$2 order by date desc limit 1`, [org, cust1])
  if (invC1b) {
    await q(`select receive_payment($1,'2026-06-01'::date,$2,$3::bigint,'bank',$4::jsonb,'Rajesh June full payment')`,
      [org, cust1, invC1b.total, JSON.stringify([{ invoice_id: invC1b.id, amount: invC1b.total }])])
  }
  const invC3a = await one(`select id,total from invoices where org_id=$1 and party_id=$2 order by date limit 1`, [org, cust3])
  if (invC3a) {
    await q(`select receive_payment($1,'2026-06-02'::date,$2,$3::bigint,'bank',$4::jsonb,'Sharma part payment')`,
      [org, cust3, Math.round(invC3a.total * 0.4),
       JSON.stringify([{ invoice_id: invC3a.id, amount: Math.round(invC3a.total * 0.4) }])])
  }

  // Payments June
  const billS3a = await one(`select id,total from bills where org_id=$1 and party_id=$2 order by date limit 1`, [org, sup3])
  if (billS3a) {
    await q(`select make_payment($1,'2026-06-01'::date,$2,$3::bigint,'bank',$4::jsonb,'National Paints payment')`,
      [org, sup3, billS3a.total, JSON.stringify([{ bill_id: billS3a.id, amount: billS3a.total }])])
  }

  // Expenses June
  await q(`select expense($1,'2026-06-01'::date,$2,4500000::bigint,'bank',null,'June rent')`, [org, await acc(org,'Rent')])
  await q(`select expense($1,'2026-06-03'::date,$2,8500000::bigint,'bank',null,'Salaries June')`, [org, await acc(org,'Salaries & Wages')])

  // Owner drawings
  await q(`select drawings($1,'2026-06-02'::date,3000000::bigint,'bank')`, [org])  // ₹30,000

  // ════════════════════════════════════════════════════════════════════════
  // CREDIT NOTES (Sales Returns)
  // ════════════════════════════════════════════════════════════════════════

  // Rajesh Hardware returns 50 kg TMT (intra-state, CGST+SGST) — damaged goods
  await q(`select sales_return($1,'2026-05-18'::date,$2,$3::jsonb,'credit','Damaged TMT bars returned')`, [org, cust1, JSON.stringify([
    { stock_item_id: tmt, qty: 50, rate: 6200 },         // ₹62/kg, same as original sale
  ])])

  // Mumbai Mega Mart returns 5 buckets paint (inter-state, IGST) — wrong colour
  await q(`select sales_return($1,'2026-05-25'::date,$2,$3::jsonb,'credit','Wrong colour paint returned')`, [org, cust2, JSON.stringify([
    { stock_item_id: paint, qty: 5, rate: 280000 },      // ₹2800/bucket
  ])])

  // ════════════════════════════════════════════════════════════════════════
  // DEBIT NOTES (Purchase Returns)
  // ════════════════════════════════════════════════════════════════════════

  // Return 20 bags cement to Gujarat Cement (inter-state, IGST) — wrong grade
  await q(`select purchase_return($1,'2026-05-20'::date,$2,$3::jsonb,'credit','Wrong grade cement returned')`, [org, sup2, JSON.stringify([
    { stock_item_id: cement, qty: 20, rate: 38000 },     // ₹380/bag, original purchase rate
  ])])

  // Return 10 GI Pipes to Bharat Steel (intra-state, CGST+SGST) — defective batch
  await q(`select purchase_return($1,'2026-06-01'::date,$2,$3::jsonb,'credit','Defective pipes returned')`, [org, sup1, JSON.stringify([
    { stock_item_id: pipe, qty: 10, rate: 28000 },       // ₹280/pc
  ])])

  await client.end()
  console.log(`\n✓ Seeded "${ORG_NAME}" for ${USER_EMAIL}`)
  console.log('  Parties  : 4 customers (Delhi/Mumbai/Bangalore/Hyderabad) + 3 suppliers')
  console.log('  Items    : 4 trading goods + 2 raw materials + 1 finished good')
  console.log('  Manufacture: 2 batches → Fabricated Steel Frames (low stock after sales)')
  console.log('  Sales    : 9 credit invoices + 2 cash sales + 2 credit notes (Apr/May/Jun)')
  console.log('  Purchases: 6 bills + 2 debit notes (Apr/May/Jun)')
  console.log('  Money    : receipts, payments, contra, capital intro, drawings')
  console.log('  Low stock: TMT (~750 kg < 1500), Cement (~190 bags < 250), Frame (5 pcs < 6)\n')

  async function sys(o, k) { return (await one(`select id from accounts where org_id=$1 and system_key=$2`, [o, k])).id }
  async function acc(o, n) { return (await one(`select id from accounts where org_id=$1 and name=$2`, [o, n])).id }
}
run().catch((e) => { console.error(e.message); process.exit(1) })
