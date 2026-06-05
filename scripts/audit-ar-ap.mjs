// audit-ar-ap.mjs — accountant-level check of receivables & payables
// DATABASE_URL=... node scripts/audit-ar-ap.mjs
import pg from 'pg'
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = (sql, p) => client.query(sql, p).then(r => r.rows)
const rs = (v) => '₹' + (Number(v) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
const ok = (label, pass, note = '') => console.log(`  ${pass ? '✓ PASS' : '✗ FAIL'} ${label}${note ? '  ← ' + note : ''}`)

async function run() {
  await client.connect()
  const [{ id: org }] = await q("select id from organizations where name='Demo Traders'")
  const EMAIL = process.env.EMAIL || 'a@a.co'
  const [u] = await q('select id from auth.users where email=$1', [EMAIL])
  await q('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: u.id })])

  console.log('\n══════════════════════════════════════════')
  console.log('  RECEIVABLES & PAYABLES AUDIT — Demo Traders')
  console.log('══════════════════════════════════════════\n')

  // ── 1. Trial balance ─────────────────────────────────────────────────────
  const [tb] = await q(`
    select sum(debit)::bigint dr, sum(credit)::bigint cr
    from ledger_entries le join accounts a on a.id = le.account_id
    where a.org_id = $1`, [org])
  const tbDiff = BigInt(tb.dr) - BigInt(tb.cr)
  console.log('── 1. Trial Balance ──')
  console.log(`   Total Debits : ${rs(tb.dr)}`)
  console.log(`   Total Credits: ${rs(tb.cr)}`)
  ok('DR = CR (double-entry intact)', tbDiff === 0n, tbDiff !== 0n ? `diff ${rs(Number(tbDiff))}` : '')

  // ── 2. Receivables — using same logic as v_dashboard_summary ─────────────
  console.log('\n── 2. Receivables ──')
  // Dashboard sums children of debtors parent account
  const [ar] = await q(`
    select coalesce(sum(le.debit - le.credit), 0)::bigint bal
    from ledger_entries le join accounts a on a.id = le.account_id
    where le.org_id = $1
      and a.parent_id = (select id from accounts where org_id = $1 and system_key = 'debtors')`, [org])

  const [inv] = await q(`
    select count(*)::int n,
           coalesce(sum(total),0)::bigint tot,
           coalesce(sum(outstanding),0)::bigint out
    from invoices where org_id = $1`, [org])

  const [dash] = await q(`
    select receivables::bigint rec, payables::bigint pay,
           cash_balance::bigint cash, bank_balance::bigint bank
    from v_dashboard_summary where org_id = $1`, [org])

  console.log(`   Invoices : ${inv.n} docs  |  Billed: ${rs(inv.tot)}  |  Outstanding: ${rs(inv.out)}`)
  console.log(`   GL (debtors children): ${rs(ar.bal)}`)
  console.log(`   Dashboard shows      : ${rs(dash.rec)}`)

  // Dashboard uses GL; invoices.outstanding is denormalised — both should agree
  ok('GL debtors = Dashboard receivables',     Number(ar.bal)  === Number(dash.rec),
     `gl=${rs(ar.bal)} dash=${rs(dash.rec)}`)

  // Check if difference between invoices table and GL is exactly credit notes
  const [cn] = await q(`
    select coalesce(sum(le.credit - le.debit), 0)::bigint tot
    from ledger_entries le join accounts a on a.id = le.account_id
    where le.org_id = $1
      and a.parent_id = (select id from accounts where org_id = $1 and system_key = 'debtors')
      and le.voucher_id in (select id from vouchers v join voucher_types vt on vt.id=v.type_id where v.org_id=$1 and vt.code='CN')`, [org])

  const arExpected = Number(inv.out) // invoices outstanding
  const arActual   = Number(ar.bal)
  const cnAdj      = Number(cn.tot)
  console.log(`   Credit-note GL credits: ${rs(cnAdj)}`)
  console.log(`   Inv.out - CN adj = ${rs(arExpected - cnAdj)}  vs GL ${rs(arActual)}`)
  ok('No invoice has outstanding > total',  (await q('select count(*)::int n from invoices where org_id=$1 and outstanding > total', [org]))[0].n === 0)
  ok('No invoice has negative outstanding', (await q('select count(*)::int n from invoices where org_id=$1 and outstanding < 0',     [org]))[0].n === 0)

  // ── 3. Payables ──────────────────────────────────────────────────────────
  console.log('\n── 3. Payables ──')
  const [ap] = await q(`
    select coalesce(sum(le.credit - le.debit), 0)::bigint bal
    from ledger_entries le join accounts a on a.id = le.account_id
    where le.org_id = $1
      and a.parent_id = (select id from accounts where org_id = $1 and system_key = 'creditors')`, [org])

  const [bil] = await q(`
    select count(*)::int n,
           coalesce(sum(total),0)::bigint tot,
           coalesce(sum(outstanding),0)::bigint out
    from bills where org_id = $1`, [org])

  console.log(`   Bills    : ${bil.n} docs  |  Billed: ${rs(bil.tot)}  |  Outstanding: ${rs(bil.out)}`)
  console.log(`   GL (creditors children): ${rs(ap.bal)}`)
  console.log(`   Dashboard shows        : ${rs(dash.pay)}`)
  ok('GL creditors = Dashboard payables',     Number(ap.bal) === Number(dash.pay),
     `gl=${rs(ap.bal)} dash=${rs(dash.pay)}`)
  ok('No bill has outstanding > total',  (await q('select count(*)::int n from bills where org_id=$1 and outstanding > total', [org]))[0].n === 0)
  ok('No bill has negative outstanding', (await q('select count(*)::int n from bills where org_id=$1 and outstanding < 0',     [org]))[0].n === 0)

  // ── 4. Aged receivables — check bucket totals per party ──────────────────
  console.log('\n── 4. Aged Receivables by Customer ──')
  const recAged = await q(`
    select party_name,
           sum(outstanding)::bigint bal,
           sum(b_0_30)::bigint c30,
           sum(b_31_60)::bigint c60,
           sum(b_61_90)::bigint c90,
           sum(b_90_plus)::bigint cplus
    from v_aged_receivables where org_id = $1
    group by party_name order by bal desc`, [org])

  for (const r of recAged) {
    const bucketSum = Number(r.c30) + Number(r.c60) + Number(r.c90) + Number(r.cplus)
    const diff = Number(r.bal) - bucketSum
    console.log(`   ${r.party_name.padEnd(26)} outstanding=${rs(r.bal)}  current=${rs(r.c30)}  31-60=${rs(r.c60)}  61-90=${rs(r.c90)}  90+=${rs(r.cplus)}`)
    ok(`  ${r.party_name} bucket sum = outstanding`, diff === 0, diff !== 0 ? `diff=${rs(diff)}` : '')
  }
  const [recTotal] = await q('select sum(outstanding)::bigint tot from v_aged_receivables where org_id=$1', [org])
  ok('Aged receivables total = GL debtors', Number(recTotal.tot) === Number(ar.bal),
     `aged=${rs(recTotal.tot)} gl=${rs(ar.bal)}`)

  // ── 5. Aged payables ─────────────────────────────────────────────────────
  console.log('\n── 5. Aged Payables by Supplier ──')
  const payAged = await q(`
    select party_name,
           sum(outstanding)::bigint bal,
           sum(b_0_30)::bigint c30,
           sum(b_31_60)::bigint c60,
           sum(b_61_90)::bigint c90,
           sum(b_90_plus)::bigint cplus
    from v_aged_payables where org_id = $1
    group by party_name order by bal desc`, [org])

  for (const r of payAged) {
    const bucketSum = Number(r.c30) + Number(r.c60) + Number(r.c90) + Number(r.cplus)
    const diff = Number(r.bal) - bucketSum
    console.log(`   ${r.party_name.padEnd(26)} outstanding=${rs(r.bal)}  current=${rs(r.c30)}  31-60=${rs(r.c60)}  61-90=${rs(r.c90)}  90+=${rs(r.cplus)}`)
    ok(`  ${r.party_name} bucket sum = outstanding`, diff === 0, diff !== 0 ? `diff=${rs(diff)}` : '')
  }
  const [payTotal] = await q('select sum(outstanding)::bigint tot from v_aged_payables where org_id=$1', [org])
  ok('Aged payables total = GL creditors', Number(payTotal.tot) === Number(ap.bal),
     `aged=${rs(payTotal.tot)} gl=${rs(ap.bal)}`)

  // ── 6. Cash & bank ───────────────────────────────────────────────────────
  console.log('\n── 6. Cash & Bank ──')
  const [cashLed] = await q(`select coalesce(sum(debit-credit),0)::bigint bal from ledger_entries le join accounts a on a.id=le.account_id where a.org_id=$1 and a.system_key='cash'`, [org])
  const [bankLed] = await q(`select coalesce(sum(debit-credit),0)::bigint bal from ledger_entries le join accounts a on a.id=le.account_id where a.org_id=$1 and a.system_key='bank'`, [org])
  console.log(`   Cash ledger: ${rs(cashLed.bal)}  |  Dashboard: ${rs(dash.cash)}`)
  console.log(`   Bank ledger: ${rs(bankLed.bal)}  |  Dashboard: ${rs(dash.bank)}`)
  ok('Cash ledger = Dashboard cash', Number(cashLed.bal) === Number(dash.cash))
  ok('Bank ledger = Dashboard bank', Number(bankLed.bal) === Number(dash.bank))
  ok('Cash not negative', Number(cashLed.bal) >= 0, Number(cashLed.bal) < 0 ? rs(cashLed.bal) : '')
  ok('Bank not negative', Number(bankLed.bal) >= 0, Number(bankLed.bal) < 0 ? rs(bankLed.bal) : '')

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══ Summary ════════════════════════════════')
  console.log(`   Cash in hand  : ${rs(dash.cash)}`)
  console.log(`   Bank balance  : ${rs(dash.bank)}`)
  console.log(`   Receivables   : ${rs(dash.rec)}   (${inv.n} invoices, ${recAged.length} customers)`)
  console.log(`   Payables      : ${rs(dash.pay)}   (${bil.n} bills, ${payAged.length} suppliers)`)
  console.log('═══════════════════════════════════════════\n')

  await client.end()
}

run().catch(e => { console.error(e.message); process.exit(1) })
