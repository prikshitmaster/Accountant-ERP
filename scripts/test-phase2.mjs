// Rolled-back validation of GST + Phase 2 money math. Leaves DB untouched.
import pg from 'pg'
import { randomUUID } from 'node:crypto'
const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const uid = randomUUID()
let pass = 0, fail = 0
const eq = (name, got, want) => {
  if (Number(got) === Number(want)) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}: got ${got} want ${want}`) }
}
const q = (sql, args) => client.query(sql, args)
const one = async (sql, args) => (await q(sql, args)).rows[0]

const run = async () => {
  await client.connect(); await q('begin')
  try {
    await q(`insert into auth.users (id, aud, role, email, created_at, updated_at)
             values ($1,'authenticated','authenticated','p2@test.local',now(),now())`, [uid])
    await q(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid })])

    const org = (await one(`select create_organization('GST Co',4::smallint) id`)).id
    await q(`update org_settings set gstin='07ABCDE1234F1Z5', state_code='07' where org_id=$1`, [org]) // Delhi

    const sup  = (await one(`select create_party($1,'Steel Supplier','supplier',null,null,'07') id`, [org])).id
    const cusL = (await one(`select create_party($1,'Local Cust','customer',null,null,'07') id`, [org])).id   // intra
    const cusO = (await one(`select create_party($1,'MH Cust','customer',null,null,'27') id`, [org])).id      // inter
    const item = (await one(`select create_stock_item($1,'TMT Bar',1::smallint,'kg',0,'7214',18) id`, [org])).id

    // purchase 100kg @ ₹50 on credit (intra, 18%): base 5,00,000p; cgst=sgst=45,000; total 5,90,000
    await q(`select purchase($1,'2026-04-05'::date,$2,$3::jsonb,'credit','buy')`,
      [org, sup, JSON.stringify([{ stock_item_id: item, qty: 100, rate: 5000 }])])
    const inv = (await one(`select id from accounts where org_id=$1 and system_key='inventory'`, [org])).id
    const icgst = (await one(`select coalesce(sum(debit-credit),0) b from ledger_entries where org_id=$1 and account_id=(select id from accounts where org_id=$1 and system_key='input_cgst')`, [org])).b
    eq('purchase: inventory at base cost ₹5,000', (await one(`select coalesce(sum(debit-credit),0) b from ledger_entries where org_id=$1 and account_id=$2`, [org, inv])).b, 500000)
    eq('purchase: input CGST 45,000p', icgst, 45000)
    eq('purchase: stock avg cost = ₹50 (excl GST)', (await one(`select avg_cost a from stock_items where id=$1`, [item])).a, 5000)

    // intra sale 10kg @ ₹80 (18%): base 80,000; cgst=sgst=7,200; total 94,400; cogs 10*5000=50,000
    await q(`select sell($1,'2026-04-10'::date,$2,$3::jsonb,'credit','sale')`,
      [org, cusL, JSON.stringify([{ stock_item_id: item, qty: 10, rate: 8000 }])])
    eq('sale intra: output CGST 7,200p', (await one(`select coalesce(sum(credit-debit),0) b from ledger_entries where org_id=$1 and account_id=(select id from accounts where org_id=$1 and system_key='output_cgst')`, [org])).b, 7200)
    eq('sale intra: invoice total 94,400p', (await one(`select total from invoices where org_id=$1 and party_id=$2`, [org, cusL])).total, 94400)

    // inter sale 5kg @ ₹80 (18%): base 40,000; igst 7,200; total 47,200
    await q(`select sell($1,'2026-04-11'::date,$2,$3::jsonb,'credit','sale')`,
      [org, cusO, JSON.stringify([{ stock_item_id: item, qty: 5, rate: 8000 }])])
    eq('sale inter: output IGST 7,200p', (await one(`select coalesce(sum(credit-debit),0) b from ledger_entries where org_id=$1 and account_id=(select id from accounts where org_id=$1 and system_key='output_igst')`, [org])).b, 7200)

    // receive full payment from local customer, allocate to its invoice
    const invL = (await one(`select id from invoices where org_id=$1 and party_id=$2`, [org, cusL])).id
    await q(`select receive_payment($1,'2026-04-12'::date,$2,94400::bigint,'bank',$3::jsonb,'rcpt')`,
      [org, cusL, JSON.stringify([{ invoice_id: invL, amount: 94400 }])])
    eq('receipt: local invoice outstanding now 0', (await one(`select outstanding from invoices where id=$1`, [invL])).outstanding, 0)

    // trial balance balanced
    const tb = await one(`select sum(closing_debit) dr, sum(closing_credit) cr from v_trial_balance where org_id=$1`, [org])
    eq('trial balance balanced', tb.dr, tb.cr)

    // GST summary: output 7200+7200+7200=21600 ; input 45000+45000=90000
    const g = await one(`select output_tax, input_credit, net_payable from v_gst_summary where org_id=$1`, [org])
    eq('gst output tax 21,600p', g.output_tax, 21600)
    eq('gst input credit 90,000p', g.input_credit, 90000)
    eq('gst net (credit) -68,400p', g.net_payable, -68400)

    // ageing: only the inter invoice remains outstanding (47,200)
    eq('aged receivables outstanding = 47,200p', (await one(`select coalesce(sum(outstanding),0) s from v_aged_receivables where org_id=$1`, [org])).s, 47200)
  } finally { await q('rollback'); await client.end() }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
run().catch((e) => { console.error(e.message); process.exit(1) })
