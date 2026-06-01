import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const uid = (await c.query(`select id from auth.users where email='a@a.co'`)).rows[0].id
console.log('a@a.co uid:', uid)
console.log('memberships (superuser):')
for (const r of (await c.query(`select org_id, role from memberships where user_id=$1`, [uid])).rows) console.log('  ', r.org_id, r.role)

// Now act as the authenticated user
await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
await c.query(`set role authenticated`)
for (const t of ['accounts', 'parties', 'stock_items', 'invoices', 'bills']) {
  try {
    const rows = (await c.query(`select org_id, count(*)::int n from ${t} group by org_id`)).rows
    console.log(`AUTH sees ${t}:`, rows.map(r => `${String(r.org_id).slice(0, 8)}=${r.n}`).join(', ') || '(none)')
  } catch (e) { console.log(`AUTH ${t}: ERROR ${e.message}`) }
}
await c.query(`reset role`)
console.log('--- superuser truth ---')
for (const t of ['accounts', 'parties', 'stock_items', 'invoices', 'bills']) {
  const rows = (await c.query(`select org_id, count(*)::int n from ${t} group by org_id`)).rows
  console.log(`TRUTH ${t}:`, rows.map(r => `${String(r.org_id).slice(0, 8)}=${r.n}`).join(', ') || '(none)')
}
await c.end()
