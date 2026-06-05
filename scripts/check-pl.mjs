import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = (sql, p) => c.query(sql, p).then(r => r.rows)
const [{id:org}] = await q("select id from organizations where name='Demo Traders'")
const rs = v => '₹'+(Number(v)/100).toLocaleString('en-IN',{minimumFractionDigits:2})
const ok = (l,p,n='') => console.log(`  ${p?'✓':'✗'} ${l}${n?' ← '+n:''}`)

// P&L from view
const [pl] = await q('select sum(income)::bigint inc, sum(expense)::bigint exp, (sum(income)-sum(expense))::bigint net from v_monthly_pl where org_id=$1',[org])
console.log('v_monthly_pl: income='+rs(pl.inc)+' expense='+rs(pl.exp)+' net='+rs(pl.net))

// P&L from GL
const glpl = await q('select a.group_id, sum(case when a.group_id=4 then le.credit-le.debit else le.debit-le.credit end)::bigint net from ledger_entries le join accounts a on a.id=le.account_id where a.org_id=$1 and a.group_id in (4,5) group by a.group_id order by a.group_id',[org])
console.log('GL income/expense:',glpl)

// BS groups
const bs = await q(`select a.group_id, sum(case when a.group_id=1 then le.debit-le.credit when a.group_id in (2,3) then le.credit-le.debit end)::bigint bal from ledger_entries le join accounts a on a.id=le.account_id where a.org_id=$1 and a.group_id in (1,2,3) group by a.group_id order by a.group_id`,[org])
console.log('BS groups:',bs)

// Stock - qty_change
const sm = await q('select si.name, si.qty_on_hand, coalesce(sum(sm.qty_change),0)::numeric ledger_qty, si.value_on_hand, coalesce(sum(sm.value_change),0)::bigint ledger_val from stock_items si left join stock_movements sm on sm.stock_item_id=si.id and sm.org_id=$1 where si.org_id=$1 and si.is_active group by si.id,si.name,si.qty_on_hand,si.value_on_hand order by si.name',[org])
console.log('\n── STOCK ──')
for(const r of sm){
  const qdiff=Number(r.qty_on_hand)-Number(r.ledger_qty)
  const vdiff=Number(r.value_on_hand)-Number(r.ledger_val)
  ok(`${r.name.padEnd(28)} qty=${r.qty_on_hand} ledger=${r.ledger_qty}`,Math.abs(qdiff)<0.001,qdiff!==0?`diff=${qdiff}`:'')
  ok(`${' '.repeat(28)} val=${rs(r.value_on_hand)} ledger=${rs(r.ledger_val)}`,vdiff===0,vdiff!==0?`diff=${rs(vdiff)}`:'')
}

// GST
const [gst]=await q('select output_tax::bigint ot,input_credit::bigint ic,net_payable::bigint net from v_gst_summary where org_id=$1',[org])
console.log('\n── GST ──')
console.log(`  Output tax=${rs(gst.ot)} Input credit=${rs(gst.ic)} Net payable=${rs(gst.net)}`)
ok('Output > 0',Number(gst.ot)>0)
ok('Input > 0', Number(gst.ic)>0)

// Voucher balance check
const [unbals]=await q(`select count(*)::int n from (select v.id from vouchers v join ledger_entries le on le.voucher_id=v.id where v.org_id=$1 group by v.id having sum(le.debit-le.credit)<>0) x`,[org])
ok('All vouchers balanced',Number(unbals.n)===0,Number(unbals.n)>0?unbals.n+' unbalanced':'')

// No negative stock
const [neg]=await q('select count(*)::int n from stock_items where org_id=$1 and qty_on_hand<0',[org])
ok('No negative stock',Number(neg.n)===0)

// Payments
const [recv]=await q(`select coalesce(sum(le.debit-le.credit),0)::bigint tot from ledger_entries le join accounts a on a.id=le.account_id join vouchers v on v.id=le.voucher_id where a.org_id=$1 and v.voucher_type=3 and a.system_key in ('cash','bank')`,[org])
const [paid]=await q(`select coalesce(sum(le.credit-le.debit),0)::bigint tot from ledger_entries le join accounts a on a.id=le.account_id join vouchers v on v.id=le.voucher_id where a.org_id=$1 and v.voucher_type=4 and a.system_key in ('cash','bank')`,[org])
console.log(`\n── PAYMENTS ──`)
console.log(`  Received=${rs(recv.tot)} Paid=${rs(paid.tot)}`)
ok('Receipts > 0',Number(recv.tot)>0)
ok('Payments > 0',Number(paid.tot)>0)

await c.end()
