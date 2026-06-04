// One-shot script: apply 0018_orders.sql in two passes to handle
// next_so_no/next_po_no forward-referencing sales_orders/purchase_orders.
// Pass 1: everything except those two SQL-language helpers
// Pass 2: the two helpers (tables now exist)
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }

const sqlFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '0018_orders.sql')
const sql = readFileSync(sqlFile, 'utf8')

// Extract the two helper function bodies verbatim from the file
const soFnMatch = sql.match(/(create or replace function next_so_no[\s\S]*?\$\$;)/m)
const poFnMatch = sql.match(/(create or replace function next_po_no[\s\S]*?\$\$;)/m)

if (!soFnMatch || !poFnMatch) {
  console.error('Could not locate helper function definitions in SQL file')
  process.exit(1)
}

const pass2 = soFnMatch[1] + '\n' + poFnMatch[1]

// Remove those two definitions from pass 1
let pass1 = sql
  .replace(/(create or replace function next_so_no[\s\S]*?\$\$;)/m, '-- next_so_no placeholder (applied in pass 2)')
  .replace(/(create or replace function next_po_no[\s\S]*?\$\$;)/m, '-- next_po_no placeholder (applied in pass 2)')

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

const run = async () => {
  await client.connect()
  console.log('Pass 1: tables, views, purchase() rewrite, RPCs (minus helpers)...')
  await client.query(pass1)
  console.log('Pass 1 OK')

  console.log('Pass 2: next_so_no + next_po_no helpers...')
  await client.query(pass2)
  console.log('Pass 2 OK')

  await client.end()
  console.log('0018_orders.sql applied successfully.')
}

run().catch(e => {
  console.error('FAILED:', e.message)
  client.end().catch(() => {})
  process.exit(1)
})
