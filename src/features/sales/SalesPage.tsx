import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useParties, useItems, useInvoices } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { ItemTable, emptyLine, type Line } from '@/components/ItemTable'
import { PageHeader } from '@/components/ui/PageHeader'

const today = () => new Date().toISOString().slice(0, 10)

export function SalesPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: customers = [] } = useParties(currentOrgId, 'customer')
  const { data: items = [] } = useItems(currentOrgId)
  const { data: invoices = [] } = useInvoices(currentOrgId)
  const partyName = (id: string) => customers.find((p) => p.id === id)?.name ?? '—'

  const [date, setDate] = useState(today())
  const [mode, setMode] = useState<'credit' | 'cash' | 'bank'>('credit')
  const [party, setParty] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [narration, setNarration] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedParty = customers.find((p) => p.id === party)
  const linesTotalPaise = lines.reduce(
    (s, l) => s + Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0')),
    0,
  )
  const overLimit =
    mode === 'credit' &&
    selectedParty &&
    selectedParty.credit_limit > 0 &&
    selectedParty.balance + linesTotalPaise > selectedParty.credit_limit

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = lines
      .filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setError('Add at least one item.'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.sell(currentOrgId, date, mode === 'credit' ? party : null, payload, mode, narration)
      setMsg(`Saved · ${res.voucher_no}`)
      setLines([emptyLine()]); setNarration('')
      ;['dashboard', 'daybook', 'invoices', 'items', 'parties', 'trial_balance', 'gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Sales" description="Record what you sell and keep track of who still owes you." />

      <Card>
        <h3 className="mb-4 font-semibold">New sale</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Payment">
              <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="credit">On credit</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </Select>
            </Field>
            {mode === 'credit' && (
              <Field label="Customer">
                <Select required value={party} onChange={(e) => setParty(e.target.value)}>
                  <option value="" disabled>Select customer…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
          </div>

          <ItemTable items={items} value={lines} onChange={setLines} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Field label="Note (optional)">
              <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Narration…" />
            </Field>
            <div className="shrink-0">
              <Button type="submit" size="lg" disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</Button>
            </div>
          </div>

          {overLimit && (
            <p className="text-sm text-warn">
              ⚠ This sale puts {selectedParty!.name} over their credit limit
              ({formatINR(selectedParty!.credit_limit)}). You can still save.
            </p>
          )}
          {error && <p className="text-sm text-neg">{error}</p>}
          {msg && <p className="text-sm text-pos">{msg}</p>}
        </form>
      </Card>

      <Card className="p-0">
        <h3 className="border-b border-line p-4 font-semibold">Invoices</h3>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>No.</th>
                <th>Customer</th>
                <th>Date</th>
                <th className="r">Total</th>
                <th className="r">Due</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/sales/${inv.id}`)}
                >
                  <td className="num">{inv.invoice_no}</td>
                  <td>{partyName(inv.party_id)}</td>
                  <td className="num">{formatDate(inv.date)}</td>
                  <td className="r num">{formatINR(inv.total, false)}</td>
                  <td className={`r num ${inv.outstanding > 0 ? 'text-warn' : 'text-pos'}`}>
                    {inv.outstanding > 0 ? formatINR(inv.outstanding, false) : 'Paid'}
                  </td>
                </tr>
              ))}
              {!invoices.length && (
                <tr><td colSpan={5} className="py-6 text-center text-muted">No invoices yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
