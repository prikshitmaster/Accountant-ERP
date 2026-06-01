// Accountant's-eye checks on the seeded books: Balance Sheet must balance,
// inventory ledger must reconcile to stock value, P&L net = income − expense.
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const one = async (s, a) => (await c.query(s, a)).rows[0]
const org = (await one(`select o.id from organizations o join memberships m on m.org_id=o.id join auth.users u on u.id=m.user_id where o.name='Demo Traders' and u.email='a@a.co'`)).id
const r = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN')
let pass = 0, fail = 0
const eq = (n, a, b, note = '') => { if (Number(a) === Number(b)) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n}: ${a} vs ${b} ${note}`) } }

const pl = await c.query(`select group_id, sum(amount)::bigint s from v_profit_loss where org_id=$1 group by group_id`, [org])
const income = Number(pl.rows.find(x => x.group_id === 4)?.s ?? 0)
const expense = Number(pl.rows.find(x => x.group_id === 5)?.s ?? 0)
const netProfit = income - expense

const bs = await c.query(`select group_id, sum(balance)::bigint s from v_balance_sheet where org_id=$1 group by group_id`, [org])
const assets = Number(bs.rows.find(x => x.group_id === 1)?.s ?? 0)
const liabilities = Number(bs.rows.find(x => x.group_id === 2)?.s ?? 0)
const equity = Number(bs.rows.find(x => x.group_id === 3)?.s ?? 0)

console.log(`Income ${r(income)} | Expense ${r(expense)} | Net profit ${r(netProfit)}`)
console.log(`Assets ${r(assets)} | Liabilities ${r(liabilities)} | Equity ${r(equity)} | +Profit ${r(equity + netProfit)}`)
eq('Balance Sheet balances (A = L + E + profit)', assets, liabilities + equity + netProfit, '(diff ' + r(assets - (liabilities + equity + netProfit)) + ')')

const rec = await one(`select ledger_balance, stock_value from v_inventory_reconciliation where org_id=$1`, [org])
eq('Inventory ledger reconciles to stock value', rec.ledger_balance, rec.stock_value)

await c.end()
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
