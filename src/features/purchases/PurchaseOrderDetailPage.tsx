import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Printer, MessageCircle, Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { usePurchaseOrderDetail } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { PurchaseOrderPrint } from './PurchaseOrderPrint'

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-500',
  confirmed: 'bg-blue-50 text-blue-700',
  billed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: po, isLoading, isError } = usePurchaseOrderDetail(currentOrgId, id ?? null)
  const [convertMode, setConvertMode] = useState<'credit' | 'cash' | 'bank'>('credit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <div className="text-muted p-8">Loading…</div>
  if (isError || !po) return <div className="text-neg p-8">Purchase order not found.</div>

  const total = po.lines.reduce((s, l) => s + l.amount, 0)

  function buildShareText() {
    const lineText = po!.lines.map((l) => `  ${l.item_name} × ${Number(l.qty)} @ ${formatINR(l.rate, false)} = ${formatINR(l.amount, false)}`).join('\n')
    return `Purchase Order ${po!.po_no}\nSupplier: ${po!.party_name}\nDate: ${formatDate(po!.date)}${po!.delivery_date ? ' | Delivery: ' + formatDate(po!.delivery_date) : ''}\nItems:\n${lineText}\nTotal: ${formatINR(total)}`
  }

  async function handleConfirm() {
    if (!currentOrgId || !id) return
    setBusy(true); setError(null)
    try {
      await rpc.confirmPurchaseOrder(currentOrgId, id)
      qc.invalidateQueries({ queryKey: ['po_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['purchase_orders'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function handleConvert() {
    if (!currentOrgId || !id) return
    setBusy(true); setError(null)
    try {
      const res = await rpc.convertPoToBill(currentOrgId, id, convertMode)
      qc.invalidateQueries({ queryKey: ['po_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['purchase_orders'] })
      qc.invalidateQueries({ queryKey: ['bills'] })
      navigate('/purchases')
      alert(`Bill created: ${res.voucher_no}`)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function handleCancel() {
    if (!currentOrgId || !id || !confirm('Cancel this order?')) return
    setBusy(true); setError(null)
    try {
      await rpc.cancelPurchaseOrder(currentOrgId, id)
      qc.invalidateQueries({ queryKey: ['po_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['purchase_orders'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const shareText = buildShareText()

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between flex-wrap gap-2">
        <button onClick={() => navigate('/purchase-orders')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to Purchase Orders
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {po.status === 'draft' && (
            <Button size="sm" onClick={handleConfirm} disabled={busy}>Confirm</Button>
          )}
          {(po.status === 'draft' || po.status === 'confirmed') && (
            <div className="flex items-center gap-1">
              <Select value={convertMode} onChange={(e) => setConvertMode(e.target.value as typeof convertMode)} className="h-8 text-xs">
                <option value="credit">On credit</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </Select>
              <Button size="sm" variant="secondary" onClick={handleConvert} disabled={busy}>Convert to Bill</Button>
            </div>
          )}
          {(po.status === 'draft' || po.status === 'confirmed') && (
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
            href={`mailto:?subject=${encodeURIComponent(`Purchase Order ${po.po_no}`)}&body=${encodeURIComponent(shareText)}`}
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
        <h1 className="text-xl font-semibold">Purchase Order {po.po_no}</h1>
        <p className="text-sm text-muted">{formatDate(po.date)} · {po.party_name}</p>
        <span className={`mt-1 inline-block capitalize text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[po.status] ?? ''}`}>{po.status}</span>
      </div>

      {error && <p className="no-print text-sm text-neg">{error}</p>}

      <Card className="no-print p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Item</th><th>Unit</th><th className="r">Qty</th><th className="r">Rate (₹)</th><th className="r">Amount</th></tr>
            </thead>
            <tbody>
              {po.lines.map((l, i) => (
                <tr key={l.line_id}>
                  <td className="num text-muted">{i + 1}</td>
                  <td>{l.item_name}</td>
                  <td className="text-muted">{l.unit}</td>
                  <td className="r num">{Number(l.qty)}</td>
                  <td className="r num">{formatINR(l.rate, false)}</td>
                  <td className="r num">{formatINR(l.amount, false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5} className="r text-sm font-semibold">Total</td><td className="r num text-sm font-semibold">{formatINR(total)}</td></tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {po.delivery_date && (
        <p className="no-print text-sm text-muted">Delivery Date: {formatDate(po.delivery_date)}</p>
      )}

      <PurchaseOrderPrint po={po} />
    </div>
  )
}
