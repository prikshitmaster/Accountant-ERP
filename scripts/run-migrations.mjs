// Applies all SQL files in supabase/migrations (sorted) to the database in
// DATABASE_URL. Each file is sent as a single multi-statement query.
//   DATABASE_URL="postgresql://...":  node scripts/run-migrations.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Set DATABASE_URL to your Supabase connection string.')
  process.exit(1)
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const only = process.argv[2] // optional: run only files containing this substring
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql') && (!only || f.includes(only)))
  .sort()

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

const run = async () => {
  await client.connect()
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8')
    process.stdout.write(`Applying ${f} … `)
    try {
      await client.query(sql)
      console.log('ok')
    } catch (e) {
      console.log('FAILED')
      console.error(`\n${f}: ${e.message}\n`)
      await client.end()
      process.exit(1)
    }
  }
  await client.end()
  console.log('\nAll migrations applied.')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
