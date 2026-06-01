import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const one = async (s, a) => (await c.query(s, a)).rows[0]
await c.connect()
const org = (await one(`select o.id from organizations o join memberships m on m.org_id=o.id join auth.users u on u.id=m.user_id where o.name='Demo Traders' and u.email='a@a.co'`)).id
const tb = await one(`select sum(closing_debit) dr, sum(closing_credit) cr from v_trial_balance where org_id=$1`, [org])
const d = await one(`select * from v_dashboard_summary where org_id=$1`, [org])
const g = await one(`select * from v_gst_summary where org_id=$1`, [org])
const inv = await one(`select coalesce(sum(value_on_hand),0) v from stock_items where org_id=$1`, [org])
const invL = await one(`select coalesce(sum(le.debit-le.credit),0) b from ledger_entries le join accounts a on a.id=le.account_id where le.org_id=$1 and a.system_key='inventory'`, [org])
const cnt = await one(`select (select count(*) from vouchers where org_id=$1) v,(select count(*) from parties where org_id=$1) p,(select count(*) from stock_items where org_id=$1) i,(select count(*) from invoices where org_id=$1) inv`, [org])
const r = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN')
console.log('TB balanced:', Number(tb.dr) === Number(tb.cr), `(dr ${r(tb.dr)} = cr ${r(tb.cr)})`)
console.log('Inventory ledger == stock value:', Number(inv.v) === Number(invL.b), `(${r(inv.v)})`)
console.log('Cash:', r(d.cash_balance), '| Bank:', r(d.bank_balance), '| Receivables:', r(d.receivables), '| Payables:', r(d.payables))
console.log('GST output:', r(g.output_tax), '| input:', r(g.input_credit), '| net:', r(g.net_payable))
console.log('Counts -> vouchers:', cnt.v, 'parties:', cnt.p, 'items:', cnt.i, 'invoices:', cnt.inv)
await c.end()
