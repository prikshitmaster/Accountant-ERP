// Tests the REAL client path: authenticated role + RLS + PostgREST (what the
// browser uses), NOT the DB-superuser path. Signs in as a@a.co and reads every
// view/table the frontend depends on, asserting rows come through RLS.
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY
const EMAIL = process.env.EMAIL || 'a@a.co'
const PASS = process.env.PASS || '123456'
if (!URL || !KEY) { console.error('Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY'); process.exit(1) }

const sb = createClient(URL, KEY, { auth: { persistSession: false } })
let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

const run = async () => {
  const { error: e } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS })
  check('sign in', !e, e?.message ?? '')
  if (e) { done(); return }

  // org via membership (RLS must let the user see their org). Pick the org with data.
  const { data: ms, error: me } = await sb.from('memberships').select('org_id, role, organizations(name)')
  check('memberships visible via RLS', !me && ms.length > 0, me?.message ?? `rows=${ms?.length}`)
  const demo = ms?.find((m) => m.organizations?.name === 'Demo Traders')
  const org = demo?.org_id ?? ms?.[0]?.org_id
  if (!org) { done(); return }

  const reads = [
    ['v_dashboard_summary', (r) => r.length === 1],
    ['v_day_book', (r) => r.length > 0],
    ['v_trial_balance', (r) => r.length > 0],
    ['v_parties', (r) => r.length > 0],
    ['v_aged_receivables', (r) => r.length > 0],
    ['v_aged_payables', (r) => r.length >= 0],
    ['v_party_ledger', (r) => r.length > 0],
    ['v_gst_summary', (r) => r.length === 1],
    ['accounts', (r) => r.length > 0],
    ['stock_items', (r) => r.length > 0],
    ['invoices', (r) => r.length > 0],
    ['bills', (r) => r.length > 0],
    ['v_stock_ledger', (r) => r.length > 0],
    ['v_inventory_reconciliation', (r) => r.length === 1],
    ['v_profit_loss', (r) => r.length > 0],
    ['v_balance_sheet', (r) => r.length > 0],
  ]
  for (const [view, ok] of reads) {
    const { data, error } = await sb.from(view).select('*').eq('org_id', org)
    check(`read ${view}`, !error && ok(data ?? []), error?.message ?? `rows=${data?.length}`)
  }

  // a write through the authenticated RPC path (role check + RLS), then verify it lands
  const tag = 'ZZ Connectivity ' + Date.now()
  const { data: pid, error: pe } = await sb.rpc('create_party', { p_org: org, p_name: tag, p_kind: 'customer' })
  check('rpc create_party (write path)', !pe && !!pid, pe?.message ?? '')
  if (pid) {
    const { data: seen } = await sb.from('v_parties').select('id').eq('org_id', org).eq('id', pid)
    check('written party visible to client', (seen ?? []).length === 1)
  }

  // a write that MUST be rejected by server validation (unbalanced voucher)
  const { error: be } = await sb.rpc('post_voucher', {
    p_org: org, p_type: 6, p_date: '2026-06-01', p_party: null, p_narration: 'bad',
    p_lines: [{ account_id: org, debit: 100, credit: 0 }], p_stock: [],
  })
  check('server rejects bad voucher', !!be)

  done()
}
function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0) }
run().catch((e) => { console.error(e); process.exit(1) })
