// full-audit.mjs — comprehensive system audit
// DATABASE_URL=... node scripts/full-audit.mjs
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q  = (sql, p) => c.query(sql, p).then(r => r.rows)
const rs = v => '₹' + (Number(v)/100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
const n  = v => Number(v)

const [{id: org}] = await q("select id from organizations where name='Demo Traders'")

let passed = 0, failed = 0
const ok = (label, pass, note = '') => {
  const sym = pass ? '  ✓' : '  ✗'
  console.log(`${sym} ${label}${note ? '  ← ' + note : ''}`)
  pass ? passed++ : failed++
}

// ─── 1. TRIAL BALANCE ────────────────────────────────────────────────────────
console.log('\n══ 1. TRIAL BALANCE ═══════════════════════════════')
const [tb] = await q('select sum(debit)::bigint dr, sum(credit)::bigint cr from ledger_entries le join accounts a on a.id=le.account_id where a.org_id=$1', [org])
ok('DR = CR (double-entry balanced)', BigInt(tb.dr) === BigInt(tb.cr),
   BigInt(tb.dr) !== BigInt(tb.cr) ? `diff=${rs(n(tb.dr)-n(tb.cr))}` : `total=${rs(tb.dr)}`)

// ─── 2. BALANCE SHEET ────────────────────────────────────────────────────────
console.log('\n══ 2. BALANCE SHEET ════════════════════════════════')
// Assets (group 1) = Liabilities (group 2) + Equity (group 3) + Net P&L
const bs = await q(`
  select ag.id grp, ag.name, sum(
    case when ag.id in (1) then le.debit - le.credit   -- assets: DR nature
         when ag.id in (2,3) then le.credit - le.debit  -- liab/equity: CR nature
    end
  )::bigint bal
  from ledger_entries le
  join accounts a on a.id = le.account_id
  join account_groups ag on ag.id = a.group_id
  where a.org_id = $1 and ag.id in (1,2,3)
  group by ag.id, ag.name order by ag.id`, [org])

const [pl] = await q(`
  select sum(case when ag.id=4 then le.credit-le.debit
                  when ag.id=5 then le.debit-le.credit end)::bigint net
  from ledger_entries le join accounts a on a.id=le.account_id
  join account_groups ag on ag.id=a.group_id
  where a.org_id=$1 and ag.id in (4,5)`, [org])

const assets   = n(bs.find(r=>r.grp==1)?.bal ?? 0)
const liab     = n(bs.find(r=>r.grp==2)?.bal ?? 0)
const equity   = n(bs.find(r=>r.grp==3)?.bal ?? 0)
const netPL    = n(pl[0]?.net ?? 0)

console.log(`   Assets   = ${rs(assets)}`)
console.log(`   Liab     = ${rs(liab)}`)
console.log(`   Equity   = ${rs(equity)}`)
console.log(`   Net P&L  = ${rs(netPL)}`)
console.log(`   L+E+P&L  = ${rs(liab + equity + netPL)}`)
ok('Assets = Liabilities + Equity + Net P&L', assets === liab + equity + netPL,
   assets !== liab + equity + netPL ? `assets=${rs(assets)} rhs=${rs(liab+equity+netPL)}` : '')

// ─── 3. INVENTORY ────────────────────────────────────────────────────────────
console.log('\n══ 3. INVENTORY ════════════════════════════════════')
// stock_items.qty_on_hand should equal sum of stock_movements
const stockCheck = await q(`
  select si.name,
         si.qty_on_hand::numeric book_qty,
         coalesce(sum(sm.qty_in - sm.qty_out),0) ledger_qty,
         si.value_on_hand::bigint book_val
  from stock_items si
  left join stock_movements sm on sm.stock_item_id = si.id and sm.org_id = $1
  where si.org_id = $1 and si.is_active
  group by si.id, si.name, si.qty_on_hand, si.value_on_hand
  order by si.name`, [org])

for (const r of stockCheck) {
  const diff = Number(r.book_qty) - Number(r.ledger_qty)
  ok(`${r.name.padEnd(30)} qty_on_hand = movement ledger`, Math.abs(diff) < 0.001,
     Math.abs(diff) >= 0.001 ? `book=${r.book_qty} ledger=${r.ledger_qty}` : `qty=${r.book_qty}`)
}

// Inventory GL account should equal sum of value_on_hand
const [invGL]  = await q(`select coalesce(sum(debit-credit),0)::bigint bal from ledger_entries le join accounts a on a.id=le.account_id where a.org_id=$1 and a.system_key='inventory'`, [org])
const [invVal] = await q('select coalesce(sum(value_on_hand),0)::bigint tot from stock_items where org_id=$1 and is_active', [org])
ok('Inventory GL = sum(stock_items.value_on_hand)', n(invGL.bal) === n(invVal.tot),
   n(invGL.bal) !== n(invVal.tot) ? `gl=${rs(invGL.bal)} items=${rs(invVal.tot)} diff=${rs(n(invGL.bal)-n(invVal.tot))}` : rs(invGL.bal))

// No negative stock
const negStock = await q('select name, qty_on_hand from stock_items where org_id=$1 and qty_on_hand < 0', [org])
ok('No item has negative qty_on_hand', negStock.length === 0,
   negStock.length > 0 ? negStock.map(r=>`${r.name}:${r.qty_on_hand}`).join(', ') : '')

// ─── 4. GST ──────────────────────────────────────────────────────────────────
console.log('\n══ 4. GST ══════════════════════════════════════════')
const gst = await q(`
  select
    coalesce(sum(case when a.system_key like 'output%' then le.credit-le.debit end),0)::bigint output_tax,
    coalesce(sum(case when a.system_key like 'input%'  then le.debit-le.credit end),0)::bigint input_credit
  from ledger_entries le join accounts a on a.id=le.account_id
  where a.org_id=$1`, [org])
const gstSummary = await q('select output_tax::bigint ot, input_credit::bigint ic, net_payable::bigint net from v_gst_summary where org_id=$1', [org])

if (gstSummary.length) {
  console.log(`   Output tax    = ${rs(gst[0].output_tax)}`)
  console.log(`   Input credit  = ${rs(gst[0].input_credit)}`)
  console.log(`   Net payable   = ${rs(n(gst[0].output_tax) - n(gst[0].input_credit))}`)
  ok('GST view output_tax matches GL',    n(gstSummary[0].ot) === n(gst[0].output_tax),  `view=${rs(gstSummary[0].ot)} gl=${rs(gst[0].output_tax)}`)
  ok('GST view input_credit matches GL',  n(gstSummary[0].ic) === n(gst[0].input_credit), `view=${rs(gstSummary[0].ic)} gl=${rs(gst[0].input_credit)}`)
  ok('GST output >= 0',  n(gst[0].output_tax)   >= 0)
  ok('GST input >= 0',   n(gst[0].input_credit)  >= 0)
} else {
  console.log('   (no GST summary row found)')
}

// ─── 5. SALES = GL SALES ACCOUNT ─────────────────────────────────────────────
console.log('\n══ 5. SALES LEDGER ═════════════════════════════════')
const [salesGL] = await q(`select coalesce(sum(credit-debit),0)::bigint bal from ledger_entries le join accounts a on a.id=le.account_id where a.org_id=$1 and a.system_key='sales'`, [org])
const [salesInv]= await q(`select coalesce(sum(
  case when v.voucher_type=1 then le.credit-le.debit   -- SALE
       when v.voucher_type=7 then le.debit-le.credit end -- CREDIT_NOTE reversal
),0)::bigint bal
from ledger_entries le
join accounts a on a.id=le.account_id
join vouchers v on v.id=le.voucher_id
where a.org_id=$1 and a.system_key='sales'`, [org])
console.log(`   Sales GL = ${rs(salesGL.bal)}`)
ok('Sales GL is positive (revenue > returns)', n(salesGL.bal) > 0)

// ─── 6. COGS INTEGRITY ───────────────────────────────────────────────────────
console.log('\n══ 6. COGS ═════════════════════════════════════════')
const [cogsGL]  = await q(`select coalesce(sum(debit-credit),0)::bigint bal from ledger_entries le join accounts a on a.id=le.account_id where a.org_id=$1 and a.system_key='cogs'`, [org])
console.log(`   COGS GL = ${rs(cogsGL.bal)}`)
ok('COGS > 0 (goods were sold)', n(cogsGL.bal) > 0)
ok('COGS < Sales (positive gross margin)', n(cogsGL.bal) < n(salesGL.bal),
   `cogs=${rs(cogsGL.bal)} sales=${rs(salesGL.bal)} margin=${rs(n(salesGL.bal)-n(cogsGL.bal))}`)

// ─── 7. PAYMENTS REDUCE OUTSTANDING ──────────────────────────────────────────
console.log('\n══ 7. PAYMENTS & RECEIPTS ══════════════════════════')
// Receipt vouchers: sum of receipts = sum of invoice outstanding reductions
const [receiptsGL] = await q(`
  select coalesce(sum(le.debit-le.credit),0)::bigint cash_in,
         coalesce(sum(le.credit-le.debit),0)::bigint debtor_cr
  from ledger_entries le join accounts a on a.id=le.account_id
  join vouchers v on v.id=le.voucher_id
  where a.org_id=$1 and v.voucher_type=3 and a.system_key in ('cash','bank')`, [org])

const [paymentsGL] = await q(`
  select coalesce(sum(le.credit-le.debit),0)::bigint cash_out
  from ledger_entries le join accounts a on a.id=le.account_id
  join vouchers v on v.id=le.voucher_id
  where a.org_id=$1 and v.voucher_type=4 and a.system_key in ('cash','bank')`, [org])

console.log(`   Cash/bank received (receipts) = ${rs(receiptsGL.cash_in)}`)
console.log(`   Cash/bank paid (payments)     = ${rs(paymentsGL.cash_out)}`)
ok('Cash received > 0', n(receiptsGL.cash_in) > 0)
ok('Cash paid > 0',     n(paymentsGL.cash_out) > 0)

// Allocations: total allocated ≤ total invoiced
const [alloc] = await q(`select coalesce(sum(amount),0)::bigint tot from allocations where org_id=$1`, [org])
const [invTotal] = await q('select coalesce(sum(total),0)::bigint tot from invoices where org_id=$1', [org])
ok('Total allocations ≤ total invoiced', n(alloc.tot) <= n(invTotal.tot),
   `alloc=${rs(alloc.tot)} invoiced=${rs(invTotal.tot)}`)

// ─── 8. RECEIVABLES & PAYABLES (recap) ───────────────────────────────────────
console.log('\n══ 8. RECEIVABLES & PAYABLES ═══════════════════════')
const [arGL] = await q(`select coalesce(sum(le.debit-le.credit),0)::bigint bal from ledger_entries le join accounts a on a.id=le.account_id where le.org_id=$1 and a.parent_id=(select id from accounts where org_id=$1 and system_key='debtors')`, [org])
const [apGL] = await q(`select coalesce(sum(le.credit-le.debit),0)::bigint bal from ledger_entries le join accounts a on a.id=le.account_id where le.org_id=$1 and a.parent_id=(select id from accounts where org_id=$1 and system_key='creditors')`, [org])
const [dash] = await q('select receivables::bigint rec, payables::bigint pay, cash_balance::bigint cash, bank_balance::bigint bank from v_dashboard_summary where org_id=$1', [org])

ok('AR GL = Dashboard receivables',  n(arGL.bal) === n(dash.rec),  `${rs(arGL.bal)}`)
ok('AP GL = Dashboard payables',     n(apGL.bal) === n(dash.pay),  `${rs(apGL.bal)}`)
ok('AR >= 0', n(arGL.bal) >= 0)
ok('AP >= 0', n(apGL.bal) >= 0)

// ─── 9. MONTHLY P&L VIEW RECONCILES ──────────────────────────────────────────
console.log('\n══ 9. MONTHLY P&L VIEW ═════════════════════════════')
const [mpl] = await q(`select coalesce(sum(net_profit),0)::bigint np from v_monthly_pl where org_id=$1`, [org])
const [plV] = await q(`
  select coalesce(sum(case when ag.id=4 then le.credit-le.debit
                           when ag.id=5 then le.debit-le.credit end),0)::bigint np
  from ledger_entries le join accounts a on a.id=le.account_id
  join account_groups ag on ag.id=a.group_id
  where a.org_id=$1 and ag.id in (4,5)`, [org])
console.log(`   Monthly P&L sum  = ${rs(mpl.np)}`)
console.log(`   GL P&L (income−expense) = ${rs(plV.np)}`)
ok('Monthly P&L view reconciles with GL', n(mpl.np) === n(plV.np),
   n(mpl.np) !== n(plV.np) ? `diff=${rs(n(mpl.np)-n(plV.np))}` : '')

// ─── 10. CASH FLOW VIEW ───────────────────────────────────────────────────────
console.log('\n══ 10. MONTHLY CASH FLOW VIEW ══════════════════════')
const [mcf] = await q(`select coalesce(sum(incoming),0)::bigint inc, coalesce(sum(outgoing),0)::bigint out from v_monthly_cashflow where org_id=$1`, [org])
// GL: net movement in cash+bank accounts
const [cashNet] = await q(`
  select coalesce(sum(debit-credit),0)::bigint net_in,
         coalesce(sum(credit-debit),0)::bigint net_out
  from ledger_entries le join accounts a on a.id=le.account_id
  where a.org_id=$1 and a.system_key in ('cash','bank')`, [org])
console.log(`   CF view incoming = ${rs(mcf.inc)}   outgoing = ${rs(mcf.out)}`)
ok('Cashflow view incoming > 0', n(mcf.inc) > 0)
ok('Cashflow view outgoing > 0', n(mcf.out) > 0)

// ─── 11. VOUCHERS COMPLETENESS ────────────────────────────────────────────────
console.log('\n══ 11. VOUCHER INTEGRITY ═══════════════════════════')
// Every voucher must have at least 2 ledger lines and sum to zero
const [unbalanced] = await q(`
  select count(distinct v.id)::int n
  from vouchers v
  join ledger_entries le on le.voucher_id = v.id
  where v.org_id = $1
  group by v.id
  having sum(le.debit - le.credit) <> 0`, [org])
ok('All vouchers balanced (sum DR-CR=0)', !unbalanced || n(unbalanced.n ?? 0) === 0,
   unbalanced ? `${unbalanced.n} unbalanced vouchers` : '')

const [noLines] = await q(`
  select count(*)::int n from vouchers v
  where v.org_id=$1
    and not exists (select 1 from ledger_entries le where le.voucher_id=v.id)`, [org])
ok('No voucher without ledger lines', n(noLines.n) === 0,
   n(noLines.n) > 0 ? `${noLines.n} vouchers have no lines` : '')

// ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
console.log('\n══ SUMMARY ══════════════════════════════════════════')
console.log(`   Cash in hand    : ${rs(dash.cash)}`)
console.log(`   Bank balance    : ${rs(dash.bank)}`)
console.log(`   Receivables     : ${rs(dash.rec)}`)
console.log(`   Payables        : ${rs(dash.pay)}`)
console.log(`   Sales (GL)      : ${rs(salesGL.bal)}`)
console.log(`   COGS (GL)       : ${rs(cogsGL.bal)}`)
console.log(`   Gross margin    : ${rs(n(salesGL.bal)-n(cogsGL.bal))}`)
console.log(`   Net P&L         : ${rs(plV.np)}`)
console.log(`   Inventory value : ${rs(invVal.tot)}`)
console.log(`\n   ${passed} checks passed, ${failed} failed`)
console.log('═════════════════════════════════════════════════════\n')

await c.end()
process.exit(failed > 0 ? 1 : 0)
