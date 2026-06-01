// Removes stray/empty demo orgs and connectivity-test parties for a@a.co,
// leaving a single clean "Demo Traders" org.
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const uid = (await c.query(`select id from auth.users where email='a@a.co'`)).rows[0].id

// drop connectivity-test parties (and their ledger accounts) anywhere — party first (FK)
await c.query(`with d as (delete from parties where name like 'ZZ Connectivity%' returning ledger_account_id)
               delete from accounts where id in (select ledger_account_id from d)`)

// delete empty orgs (no stock items AND no vouchers) owned by this user
const stray = (await c.query(`
  select o.id, o.name from organizations o
  join memberships m on m.org_id = o.id and m.user_id = $1
  where not exists (select 1 from stock_items s where s.org_id = o.id)
    and not exists (select 1 from invoices i where i.org_id = o.id)`, [uid])).rows
for (const s of stray) {
  await c.query(`delete from organizations where id = $1`, [s.id])
  console.log('deleted stray org', String(s.id).slice(0, 8), `"${s.name}"`)
}
const left = (await c.query(`select o.name from organizations o join memberships m on m.org_id=o.id where m.user_id=$1`, [uid])).rows
console.log('remaining orgs for a@a.co:', left.map(r => r.name).join(', ') || '(none)')
await c.end()
