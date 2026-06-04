import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Printer, MessageCircle, Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSalesOrderDetail } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { SalesOrderPrint } from './SalesOrderPrint'

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-500',
  confirmed: 'bg-blue-50 text-blue-700',
  invoiced: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
}

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: so, isLoading, isError } = useSalesOrderDetail(currentOrgId, id ?? null)
  const [convertMode, setConvertMode] = useState<'credit' | 'cash' | 'bank'>('credit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <div className="text-muted p-8">Loading…</div>
  if (isError || !so) return <div className="text-neg p-8">Sales order not found.</div>

  const subtotal = so.lines.reduce((s, l) => s + l.amount, 0)
  const taxable = subtotal - so.discount_amount
  const gstTotal = so.lines.reduce((s, l) => l.gst_rate > 0 ? s + Math.round(l.amount * l.gst_rate / 100) : s, 0)
  const scaledGst = subtotal > 0 ? Math.round(gstTotal * taxable / subtotal) : 0
  const total = taxable + scaledGst + so.freight_amount

  function buildShareText() {
    const lineText = so!.lines.map((l) => `  ${l.item_name} × ${Number(l.qty)} @ ${formatINR(l.rate, false)} = ${formatINR(l.amount, false)}`).join('\n')
    return `Sales Order ${so!.so_no}\nCustomer: ${so!.party_name}\nDate: ${formatDate(so!.date)}${so!.delivery_date ? ' | Delivery: ' + formatDate(so!.delivery_date) : ''}\nItems:\n${lineText}\nTotal: ${formatINR(total)}`
  }

  async function handleConfirm() {
    if (!currentOrgId || !id) return
    setBusy(true); setError(null)
    try {
      await rpc.confirmSalesOrder(currentOrgId, id)
      qc.invalidateQueries({ queryKey: ['so_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['sales_orders'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function handleConvert() {
    if (!currentOrgId || !id) return
    setBusy(true); setError(null)
    try {
      const res = await rpc.convertSoToInvoice(currentOrgId, id, convertMode)
      qc.invalidateQueries({ queryKey: ['so_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['sales_orders'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      navigate('/sales')
      alert(`Invoice created: ${res.voucher_no}`)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function handleCancel() {
    if (!currentOrgId || !id || !confirm('Cancel this order?')) return
    setBusy(true); setError(null)
    try {
      await rpc.cancelSalesOrder(currentOrgId, id)
      qc.invalidateQueries({ queryKey: ['so_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['sales_orders'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const shareText = buildShareText()

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between flex-wrap gap-2">
        <button onClick={() => navigate('/sales-orders')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to Sales Orders
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {so.status === 'draft' && (
            <Button size="sm" onClick={handleConfirm} disabled={busy}>Confirm</Button>
          )}
          {(so.status === 'draft' || so.status === 'confirmed') && (
            <div className="flex items-center gap-1">
              <Select value={convertMode} onChange={(e) => setConvertMode(e.target.value as typeof convertMode)} className="h-8 text-xs">
                <option value="credit">On credit</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </Select>
              <Button size="sm" variant="secondary" onClick={handleConvert} disabled={busy}>Convert to Invoice</Button>
            </div>
          )}
          {(so.status === 'draft' || so.status === 'confirmed') && (
            <Button size="sm" variant="secondary" onClick={handleCancel} disabled={busy}>Cancel</Button>
          )}
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-green-600 hover:opacity-80"
          >
            <MessageCircle size={16} /> WhatsApp
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent(`Sales Order ${so.so_no}`)}&body=${encodeURIComponent(shareText)}`}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:opacity-80"
          >
            <Mail size={16} /> Email
          </a>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      <div className="no-print">
        <h1 className="text-xl font-semibold">Sales Order {so.so_no}</h1>
        <p className="text-sm text-muted">{formatDate(so.date)} · {so.party_name}</p>
        <span className={`mt-1 inline-block capitalize text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[so.status] ?? ''}`}>{so.status}</span>
      </div>

      {error && <p className="no-print text-sm text-neg">{error}</p>}

      <Card className="no-print p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Item</th><th>Unit</th><th className="r">Qty</th><th className="r">Rate (₹)</th><th className="r">GST %</th><th className="r">Amount</th></tr>
            </thead>
            <tbody>
              {so.lines.map((l, i) => (
                <tr key={l.line_id}>
                  <td className="num text-muted">{i + 1}</td>
                  <td>{l.item_name}</td>
                  <td className="text-muted">{l.unit}</td>
                  <td className="r num">{Number(l.qty)}</td>
                  <td className="r num">{formatINR(l.rate, false)}</td>
                  <td className="r num text-muted">{Number(l.gst_rate) > 0 ? `${l.gst_rate}%` : '—'}</td>
                  <td className="r num">{formatINR(l.amount, false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {so.discount_amount > 0 && (
                <tr><td colSpan={6} className="r text-sm text-muted">− Discount</td><td className="r num text-sm">{formatINR(so.discount_amount, false)}</td></tr>
              )}
              {scaledGst > 0 && (
                <tr><td colSpan={6} className="r text-sm text-muted">GST</td><td className="r num text-sm">{formatINR(scaledGst, false)}</td></tr>
              )}
              {so.freight_amount > 0 && (
                <tr><td colSpan={6} className="r text-sm text-muted">+ Freight</td><td className="r num text-sm">{formatINR(so.freight_amount, false)}</td></tr>
              )}
              <tr><td colSpan={6} className="r text-sm font-semibold">Total</td><td className="r num text-sm font-semibold">{formatINR(total)}</td></tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {so.delivery_date && (
        <p className="no-print text-sm text-muted">Delivery Date: {formatDate(so.delivery_date)}</p>
      )}

      <SalesOrderPrint so={so} />
    </div>
  )
}
