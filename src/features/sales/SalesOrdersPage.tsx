// src/features/sales/SalesOrdersPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useParties, useItems, useSalesOrders } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { ItemTable, emptyLine, lineError, type Line } from '@/components/ItemTable'

const today = () => new Date().toISOString().slice(0, 10)

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-500',
  confirmed: 'bg-blue-50 text-blue-700',
  invoiced: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
}

export function SalesOrdersPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: customers = [] } = useParties(currentOrgId, 'customer')
  const { data: items = [] } = useItems(currentOrgId)
  const { data: orders = [] } = useSalesOrders(currentOrgId)

  const [date, setDate] = useState(today())
  const [deliveryDate, setDeliveryDate] = useState('')
  const [party, setParty] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [discount, setDiscount] = useState('')
  const [freight, setFreight] = useState('')
  const [narration, setNarration] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const linesTotalPaise = lines.reduce(
    (s, l) => s + Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0')), 0)
  const discountPaise = rupeesToPaise(discount || '0')
  const freightPaise = rupeesToPaise(freight || '0')
  const gstPaise = lines.reduce((s, l) => {
    const it = items.find((x) => x.id === l.stock_item_id)
    const base = Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0'))
    return s + (it ? Math.round(base * Number(it.gst_rate) / 100) : 0)
  }, 0)
  const taxable = Math.max(0, linesTotalPaise - discountPaise)
  const scaledGst = linesTotalPaise > 0 ? Math.round(gstPaise * taxable / linesTotalPaise) : 0
  const total = taxable + scaledGst + freightPaise

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = lines
      .filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setError('Add at least one item.'); return }
    if (!party) { setError('Select a customer.'); return }
    const badLine = lines.find((l) => lineError(l))
    if (badLine) { setError(lineError(badLine)!); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.createSalesOrder(
        currentOrgId, date, party, payload,
        deliveryDate || undefined, narration || undefined,
        discountPaise, freightPaise,
      )
      setMsg(`Saved · ${res.so_no}`)
      setLines([emptyLine()]); setDiscount(''); setFreight(''); setNarration(''); setDeliveryDate('')
      qc.invalidateQueries({ queryKey: ['sales_orders'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Sales Orders</h1>
        <p className="text-sm text-muted mt-0.5">Pre-invoice commitment documents for customers.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h3 className="mb-4 font-semibold">New Sales Order</h3>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
              <Field label="Delivery Date"><Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></Field>
            </div>
            <Field label="Customer">
              <Select required value={party} onChange={(e) => setParty(e.target.value)}>
                <option value="" disabled>Select customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <ItemTable items={items} value={lines} onChange={setLines} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Discount (₹)"><Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
              <Field label="Freight (₹)"><Input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" /></Field>
            </div>
            <div className="space-y-1 text-sm border-t border-line pt-3">
              {scaledGst > 0 && (
                <div className="flex justify-between text-muted"><span>GST</span><span className="num">{formatINR(scaledGst, false)}</span></div>
              )}
              <div className="flex justify-between font-semibold border-t border-line pt-1">
                <span>Total</span><span className="num">{formatINR(total)}</span>
              </div>
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
          <div className="px-4 py-3 border-b border-line font-semibold text-sm">All Sales Orders</div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>No.</th><th>Customer</th><th>Date</th><th>Status</th><th className="r">Total</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/sales-orders/${o.id}`)}>
                    <td className="num">{o.so_no}</td>
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
                  <tr><td colSpan={5} className="py-6 text-center text-muted">No sales orders yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
