import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts, useParties, useInvoices, useBills } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate, paiseToRupees } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Input, Field, Select } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'

type Action = 'receive' | 'pay' | 'expense' | 'transfer' | 'capital' | 'drawings'
const today = () => new Date().toISOString().slice(0, 10)

export function MoneyPage() {
  const { currentOrgId, role } = useAuth()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts(currentOrgId)
  const { data: customers = [] } = useParties(currentOrgId, 'customer')
  const { data: suppliers = [] } = useParties(currentOrgId, 'supplier')
  const [action, setAction] = useState<Action>('receive')
  const elevated = role === 'owner' || role === 'accountant'

  const expenseAccounts = accounts.filter((a) => a.group_id === 5 && a.system_key !== 'cogs')
  const cash = accounts.find((a) => a.system_key === 'cash')
  const bank = accounts.find((a) => a.system_key === 'bank')

  const tabs: { id: Action; label: string; show: boolean }[] = [
    { id: 'receive', label: 'Receive', show: true },
    { id: 'pay', label: 'Pay', show: true },
    { id: 'expense', label: 'Expense', show: true },
    { id: 'transfer', label: 'Cash ↔ Bank', show: true },
    { id: 'capital', label: 'Capital', show: elevated },
    { id: 'drawings', label: 'Drawings', show: elevated },
  ]

  const invalidate = () =>
    ['dashboard', 'daybook', 'invoices', 'bills', 'parties', 'trial_balance', 'gst', 'payments_received', 'payments_made'].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }))

  return (
    <div className="space-y-5">
      <PageHeader title="Money" description="Receive payments, pay bills, move cash between accounts, and log expenses." />
      <div className="flex flex-wrap gap-2">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} onClick={() => setAction(t.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm ${action === t.id ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-muted'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-xl">
        {action === 'receive' && <Settle kind="receive" parties={customers} onDone={invalidate} />}
        {action === 'pay' && <Settle kind="pay" parties={suppliers} onDone={invalidate} />}
        {action === 'expense' && (
          <SimpleForm
            fields={[{ key: 'account', label: 'Expense type', options: expenseAccounts.map((a) => ({ value: a.id, label: a.name })) }]}
            onSubmit={(orgId, v) => rpc.expense(orgId, v.date, v.account, rupeesToPaise(v.amount), v.mode as 'cash' | 'bank', v.note)}
            withMode withNote cta="Record expense" onDone={invalidate}
          />
        )}
        {action === 'transfer' && (
          <SimpleForm
            fields={[{ key: 'dir', label: 'Direction', options: [{ value: 'c2b', label: 'Cash → Bank' }, { value: 'b2c', label: 'Bank → Cash' }] }]}
            onSubmit={(orgId, v) => {
              const from = v.dir === 'c2b' ? cash!.id : bank!.id
              const to = v.dir === 'c2b' ? bank!.id : cash!.id
              return rpc.contra(orgId, v.date, from, to, rupeesToPaise(v.amount), v.note)
            }}
            withNote cta="Transfer" onDone={invalidate}
          />
        )}
        {action === 'capital' && (
          <SimpleForm onSubmit={(orgId, v) => rpc.introduceCapital(orgId, v.date, rupeesToPaise(v.amount), v.mode as 'cash' | 'bank')} withMode cta="Add capital" onDone={invalidate} />
        )}
        {action === 'drawings' && (
          <SimpleForm onSubmit={(orgId, v) => rpc.drawings(orgId, v.date, rupeesToPaise(v.amount), v.mode as 'cash' | 'bank')} withMode cta="Record drawings" onDone={invalidate} />
        )}
      </div>
    </div>
  )
}

/* ---- Generic single-amount form (expense/transfer/capital/drawings) ---- */
type FieldDef = { key: string; label: string; options: { value: string; label: string }[] }
function SimpleForm({
  fields = [], withMode, withNote, cta, onSubmit, onDone,
}: {
  fields?: FieldDef[]; withMode?: boolean; withNote?: boolean; cta: string
  onSubmit: (orgId: string, v: Record<string, string>) => Promise<unknown>; onDone: () => void
}) {
  const { currentOrgId } = useAuth()
  const [v, setV] = useState<Record<string, string>>({ date: today(), amount: '', mode: 'cash', note: '' })
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [error, setError] = useState<string | null>(null)
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!currentOrgId) return
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = (await onSubmit(currentOrgId, v)) as { voucher_no?: string }
      setMsg(res?.voucher_no ? `Saved · ${res.voucher_no}` : 'Saved')
      setV((s) => ({ ...s, amount: '', note: '' })); onDone()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Date"><Input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} required /></Field>
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <Select required value={v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
              <option value="" disabled>Select…</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        ))}
        <Field label="Amount (₹)"><Input inputMode="decimal" required value={v.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" /></Field>
        {withMode && (
          <Field label="Via">
            <Select value={v.mode} onChange={(e) => set('mode', e.target.value)}>
              <option value="cash">Cash</option><option value="bank">Bank</option>
            </Select>
          </Field>
        )}
        {withNote && <Field label="Note (optional)"><Input value={v.note} onChange={(e) => set('note', e.target.value)} /></Field>}
        {error && <p className="text-sm text-neg">{error}</p>}
        {msg && <p className="text-sm text-pos">{msg}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Saving…' : cta}</Button>
      </form>
    </Card>
  )
}

/* ---- Receive / Pay with bill-wise allocation ---- */
function Settle({ kind, parties, onDone }: {
  kind: 'receive' | 'pay'; parties: { id: string; name: string }[]; onDone: () => void
}) {
  const { currentOrgId } = useAuth()
  const [party, setParty] = useState('')
  const [date, setDate] = useState(today())
  const [mode, setMode] = useState<'cash' | 'bank'>('bank')
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [error, setError] = useState<string | null>(null)

  const invoices = useInvoices(currentOrgId, kind === 'receive' ? party || undefined : undefined, true)
  const bills = useBills(currentOrgId, kind === 'pay' ? party || undefined : undefined, true)
  const docs = (kind === 'receive' ? invoices.data : bills.data) ?? []

  useEffect(() => { setAlloc({}) }, [party])
  const total = Object.values(alloc).reduce((s, a) => s + rupeesToPaise(a || '0'), 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!currentOrgId || !party) return
    const allocations = docs
      .filter((d) => rupeesToPaise(alloc[d.id] || '0') > 0)
      .map((d) => kind === 'receive'
        ? { invoice_id: d.id, amount: rupeesToPaise(alloc[d.id]) }
        : { bill_id: d.id, amount: rupeesToPaise(alloc[d.id]) })
    if (!allocations.length) { setError('Enter at least one amount.'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const fn = kind === 'receive' ? rpc.receivePayment : rpc.makePayment
      const res = await fn(currentOrgId, date, party, total, mode, allocations, kind === 'receive' ? 'Receipt' : 'Payment')
      setMsg(`Saved · ${res.voucher_no}`); setAlloc({}); onDone()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Into / from">
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'cash' | 'bank')}>
              <option value="bank">Bank</option><option value="cash">Cash</option>
            </Select>
          </Field>
        </div>
        <Field label={kind === 'receive' ? 'Customer' : 'Supplier'}>
          <Select required value={party} onChange={(e) => setParty(e.target.value)}>
            <option value="" disabled>Select…</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>

        {party && (
          <div className="rounded-xl border border-line">
            <p className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Open {kind === 'receive' ? 'invoices' : 'bills'}
            </p>
            {docs.length ? docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="num text-sm">{(d as { invoice_no?: string; bill_no?: string }).invoice_no ?? (d as { bill_no?: string }).bill_no}</p>
                  <p className="text-xs text-muted">{formatDate(d.date)} · due <span className="num">{formatINR(d.outstanding)}</span></p>
                </div>
                <Input
                  className="h-10 w-28 text-right" inputMode="decimal" placeholder="0"
                  value={alloc[d.id] ?? ''}
                  onChange={(e) => setAlloc((s) => ({ ...s, [d.id]: e.target.value }))}
                  onFocus={() => setAlloc((s) => (s[d.id] ? s : { ...s, [d.id]: String(paiseToRupees(d.outstanding)) }))}
                />
              </div>
            )) : <p className="px-3 py-4 text-center text-sm text-muted">Nothing outstanding.</p>}
          </div>
        )}

        <div className="flex justify-between text-sm">
          <span className="text-muted">Total {kind === 'receive' ? 'received' : 'paid'}</span>
          <span className="num font-semibold">{formatINR(total)}</span>
        </div>
        {error && <p className="text-sm text-neg">{error}</p>}
        {msg && <p className="text-sm text-pos">{msg}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || total === 0}>
          {busy ? 'Saving…' : kind === 'receive' ? 'Record receipt' : 'Record payment'}
        </Button>
      </form>
    </Card>
  )
}
