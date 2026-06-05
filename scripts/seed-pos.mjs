// seed-pos.mjs — adds demo Purchase Orders to Demo Traders
// DATABASE_URL=... node scripts/seed-pos.mjs
import pg from 'pg'
const url = process.env.DATABASE_URL
const EMAIL = process.env.EMAIL || 'a@a.co'
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const q   = (sql, a) => client.query(sql, a)
const one = async (sql, a) => (await q(sql, a)).rows[0]
const createPO = async (orgId, date, party, items, delivery, narration) => {
  const { rows } = await q(
    `select create_purchase_order($1,$2,$3,$4::jsonb,$5,$6) r`,
    [orgId, date, party, JSON.stringify(items), delivery ?? null, narration ?? null],
  )
  return rows[0].r
}
const confirmPO = async (orgId, poId) => {
  await q(`select confirm_purchase_order($1,$2)`, [orgId, poId])
}

async function run() {
  await client.connect()
  const u = await one(`select id from auth.users where email=$1`, [EMAIL])
  if (!u) { console.error(`No user ${EMAIL}`); process.exit(1) }
  const uid = u.id
  await q(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: uid })])

  const org = await one(`select id from organizations where name='Demo Traders' and id in (select org_id from memberships where user_id=$1)`, [uid])
  if (!org) { console.error('Demo Traders org not found — run seed-demo.mjs first'); process.exit(1) }
  const orgId = org.id

  const steel  = await one(`select id from parties where org_id=$1 and name='Bharat Steel Co'`, [orgId])
  const cement = await one(`select id from parties where org_id=$1 and name='Gujarat Cement Ltd'`, [orgId])
  const paint  = await one(`select id from parties where org_id=$1 and name='National Paints Pvt Ltd'`, [orgId])

  const tmt    = await one(`select id from stock_items where org_id=$1 and name='TMT Steel Bar 12mm'`, [orgId])
  const bag    = await one(`select id from stock_items where org_id=$1 and name='Cement Bag 50kg'`, [orgId])
  const pipe   = await one(`select id from stock_items where org_id=$1 and name='GI Pipe 1 inch'`, [orgId])
  const bucket = await one(`select id from stock_items where org_id=$1 and name='Wall Paint 20L'`, [orgId])
  const wire   = await one(`select id from stock_items where org_id=$1 and name='Steel Wire Rod'`, [orgId])

  // Helper: paise
  const p = (rs) => Math.round(rs * 100)

  const pos = [
    // confirmed (older, already actioned)
    { date: '2026-04-10', delivery: '2026-04-25', party: steel.id,  status: 'confirmed',
      items: [{ stock_item_id: tmt.id,  qty: 5000, rate: p(56) },
              { stock_item_id: wire.id, qty: 1000, rate: p(62) }],
      narration: 'Q1 steel stock replenishment' },
    { date: '2026-04-12', delivery: '2026-04-30', party: cement.id, status: 'confirmed',
      items: [{ stock_item_id: bag.id,  qty: 800,  rate: p(355) }],
      narration: 'Monsoon stock build-up' },
    // billed (converted to bills)
    { date: '2026-03-20', delivery: '2026-04-05', party: steel.id,  status: 'billed',
      items: [{ stock_item_id: tmt.id,  qty: 3000, rate: p(55) }],
      narration: 'FY end stock purchase' },
    { date: '2026-05-02', delivery: '2026-05-20', party: paint.id,  status: 'billed',
      items: [{ stock_item_id: bucket.id, qty: 100, rate: p(2400) },
              { stock_item_id: pipe.id,   qty: 200, rate: p(480) }],
      narration: 'Paint and pipe restock' },
    // draft (pending approval)
    { date: '2026-06-03', delivery: '2026-06-25', party: steel.id,  status: 'draft',
      items: [{ stock_item_id: tmt.id,  qty: 8000, rate: p(57) },
              { stock_item_id: wire.id, qty: 2000, rate: p(63) }],
      narration: 'June steel order — awaiting approval' },
    { date: '2026-06-04', delivery: '2026-07-01', party: cement.id, status: 'draft',
      items: [{ stock_item_id: bag.id,  qty: 1200, rate: p(360) }],
      narration: 'Pre-monsoon cement stock' },
    { date: '2026-06-04', delivery: '2026-06-20', party: paint.id,  status: 'draft',
      items: [{ stock_item_id: bucket.id, qty: 60,  rate: p(2450) }],
      narration: 'Paint order for June deliveries' },
  ]

  for (const po of pos) {
    const res = await createPO(orgId, po.date, po.party, po.items, po.delivery, po.narration)
    const poId = res.po_id
    if (po.status === 'confirmed' || po.status === 'billed') {
      await confirmPO(orgId, poId)
    }
    console.log(`  ${po.status.padEnd(9)} ${res.po_no}  ${po.narration}`)
  }

  console.log('\nDone — purchase orders seeded.')
  await client.end()
}

run().catch((e) => { console.error(e); process.exit(1) })
