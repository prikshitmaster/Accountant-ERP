import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useParties, useItems, useBills } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { ItemLines, emptyLine, type Line } from '@/components/ItemLines'
import { PageHeader } from '@/components/ui/PageHeader'

const today = () => new Date().toISOString().slice(0, 10)

export function PurchasesPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const { data: suppliers = [] } = useParties(currentOrgId, 'supplier')
  const { data: items = [] } = useItems(currentOrgId)
  const { data: bills = [] } = useBills(currentOrgId)
  const partyName = (id: string) => suppliers.find((p) => p.id === id)?.name ?? '—'

  const [date, setDate] = useState(today())
  const [mode, setMode] = useState<'credit' | 'cash' | 'bank'>('credit')
  const [party, setParty] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [narration, setNarration] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = lines
      .filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setError('Add at least one item.'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.purchase(currentOrgId, date, mode === 'credit' ? party : null, payload, mode, narration)
      setMsg(`Saved · ${res.voucher_no}`)
      setLines([emptyLine()]); setNarration('')
      ;['dashboard', 'daybook', 'bills', 'items', 'parties', 'trial_balance', 'gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Purchases" description="Record what you buy and what you still owe your suppliers." />
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">New purchase</h3>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
              <Field label="Payment">
                <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  <option value="credit">On credit</option>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                </Select>
              </Field>
            </div>
            {mode === 'credit' && (
              <Field label="Supplier">
                <Select required value={party} onChange={(e) => setParty(e.target.value)}>
                  <option value="" disabled>Select supplier…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
            <ItemLines items={items} value={lines} onChange={setLines} rateLabel="Cost price" priceField="purchase_price" />
            <Field label="Note (optional)"><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
            {error && <p className="text-sm text-neg">{error}</p>}
            {msg && <p className="text-sm text-pos">{msg}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Record purchase'}</Button>
          </form>
        </Card>

        <Card className="p-0">
          <h3 className="border-b border-line p-4 font-semibold">Bills</h3>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>No.</th><th>Supplier</th><th>Date</th><th className="r">Total</th><th className="r">Due</th></tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td className="num">{b.bill_no}</td>
                    <td>{partyName(b.party_id)}</td>
                    <td className="num">{formatDate(b.date)}</td>
                    <td className="r num">{formatINR(b.total, false)}</td>
                    <td className={`r num ${b.outstanding > 0 ? 'text-warn' : 'text-pos'}`}>{b.outstanding > 0 ? formatINR(b.outstanding, false) : 'Paid'}</td>
                  </tr>
                ))}
                {!bills.length && <tr><td colSpan={5} className="py-6 text-center text-muted">No bills yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
