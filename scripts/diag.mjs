import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const tables = ['accounts', 'parties', 'stock_items', 'invoices', 'bills', 'vouchers', 'ledger_entries']
console.log('--- RLS enabled? ---')
for (const t of (await c.query(`select relname, relrowsecurity from pg_class where relname = any($1)`, [tables])).rows)
  console.log(' ', t.relname, 'rls=', t.relrowsecurity)
console.log('--- SELECT grants to authenticated ---')
for (const t of tables) {
  const g = (await c.query(`select privilege_type from information_schema.role_table_grants where table_name=$1 and grantee='authenticated'`, [t])).rows.map(r => r.privilege_type)
  console.log(' ', t, '->', g.join(',') || '(none)')
}
console.log('--- policies ---')
for (const p of (await c.query(`select tablename, policyname, cmd, qual from pg_policies where tablename = any($1) order by tablename`, [tables])).rows)
  console.log(' ', p.tablename, '|', p.policyname, '|', p.cmd, '|', String(p.qual).slice(0, 60))
await c.end()
