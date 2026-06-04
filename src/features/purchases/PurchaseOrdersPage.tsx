// src/features/purchases/PurchaseOrdersPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useParties, useItems, usePurchaseOrders } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { ItemLines, emptyLine, type Line } from '@/components/ItemLines'

const today = () => new Date().toISOString().slice(0, 10)

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-500',
  confirmed: 'bg-blue-50 text-blue-700',
  billed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
}

export function PurchaseOrdersPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: suppliers = [] } = useParties(currentOrgId, 'supplier')
  const { data: items = [] } = useItems(currentOrgId)
  const { data: orders = [] } = usePurchaseOrders(currentOrgId)

  const [date, setDate] = useState(today())
  const [deliveryDate, setDeliveryDate] = useState('')
  const [party, setParty] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [narration, setNarration] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const totalPaise = lines.reduce(
    (s, l) => s + Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0')), 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = lines
      .filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setError('Add at least one item.'); return }
    if (!party) { setError('Select a supplier.'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.createPurchaseOrder(
        currentOrgId, date, party, payload,
        deliveryDate || undefined, narration || undefined,
      )
      setMsg(`Saved · ${res.po_no}`)
      setLines([emptyLine()]); setNarration(''); setDeliveryDate('')
      qc.invalidateQueries({ queryKey: ['purchase_orders'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Purchase Orders</h1>
        <p className="text-sm text-muted mt-0.5">Pre-bill commitment documents for suppliers.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h3 className="mb-4 font-semibold">New Purchase Order</h3>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
              <Field label="Delivery Date"><Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></Field>
            </div>
            <Field label="Supplier">
              <Select required value={party} onChange={(e) => setParty(e.target.value)}>
                <option value="" disabled>Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <ItemLines items={items} value={lines} onChange={setLines} rateLabel="Cost price" priceField="purchase_price" />
            <div className="flex justify-between font-semibold text-sm border-t border-line pt-3">
              <span>Total</span><span className="num">{formatINR(totalPaise)}</span>
            </div>
            <Field label="Note (optional)">
              <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Narration…" />
            </Field>
            {error && <p className="text-sm text-neg">{error}</p>}
            {msg && <p className="text-sm text-pos">{msg}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save as Draft'}</Button>
          </form>
        </Card>

        <Card className="p-0">
          <div className="px-4 py-3 border-b border-line font-semibold text-sm">All Purchase Orders</div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>No.</th><th>Supplier</th><th>Date</th><th>Status</th><th className="r">Total</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/purchase-orders/${o.id}`)}>
                    <td className="num">{o.po_no}</td>
                    <td>{o.party_name}</td>
                    <td className="num">{formatDate(o.date)}</td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[o.status] ?? ''}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="r num">{formatINR(o.total, false)}</td>
                  </tr>
                ))}
                {!orders.length && (
                  <tr><td colSpan={5} className="py-6 text-center text-muted">No purchase orders yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
