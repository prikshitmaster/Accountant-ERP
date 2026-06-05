import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Printer, MessageCircle, Mail, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSalesOrderDetail } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR, formatDate } from '@/lib/money'
import { Select } from '@/components/ui/Input'
import { SalesOrderPrint } from './SalesOrderPrint'

const STATUS_BADGE: Record<string, string> = {
  draft:     'bg-zinc-100 text-zinc-600',
  confirmed: 'bg-blue-50 text-blue-700',
  invoiced:  'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-500',
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
  const [success, setSuccess] = useState<string | null>(null)
  const [cancelPending, setCancelPending] = useState(false)

  if (isLoading) return <div className="text-muted p-8">Loading…</div>
  if (isError || !so) return <div className="text-neg p-8">Sales order not found.</div>

  const subtotal  = so.lines.reduce((s, l) => s + l.amount, 0)
  const taxable   = subtotal - so.discount_amount
  const gstTotal  = so.lines.reduce((s, l) => l.gst_rate > 0 ? s + Math.round(l.amount * l.gst_rate / 100) : s, 0)
  const scaledGst = subtotal > 0 ? Math.round(gstTotal * taxable / subtotal) : 0
  const total     = taxable + scaledGst + so.freight_amount
  const canAct    = so.status === 'draft' || so.status === 'confirmed'

  function buildShareText() {
    const lineText = so!.lines
      .map((l) => `  ${l.item_name} × ${Number(l.qty)} @ ${formatINR(l.rate, false)} = ${formatINR(l.amount, false)}`)
      .join('\n')
    return `Sales Order ${so!.so_no}\nCustomer: ${so!.party_name}\nDate: ${formatDate(so!.date)}${so!.delivery_date ? '\nDelivery: ' + formatDate(so!.delivery_date) : ''}\n\nItems:\n${lineText}\n\nTotal: ${formatINR(total)}`
  }

  async function handleConfirm() {
    if (!currentOrgId || !id) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await rpc.confirmSalesOrder(currentOrgId, id)
      qc.invalidateQueries({ queryKey: ['so_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['sales_orders'] })
      setSuccess('Order confirmed.')
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function handleConvert() {
    if (!currentOrgId || !id) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const res = await rpc.convertSoToInvoice(currentOrgId, id, convertMode)
      qc.invalidateQueries({ queryKey: ['so_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['sales_orders'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      setSuccess(`Invoice ${res.voucher_no} created — redirecting…`)
      setTimeout(() => navigate('/sales'), 1500)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function handleCancel() {
    if (!currentOrgId || !id) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await rpc.cancelSalesOrder(currentOrgId, id)
      qc.invalidateQueries({ queryKey: ['so_detail', currentOrgId, id] })
      qc.invalidateQueries({ queryKey: ['sales_orders'] })
      setCancelPending(false)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const shareText = buildShareText()

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigate('/sales-orders')}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-none">{so.so_no}</h1>
          <p className="mt-0.5 text-xs text-muted">{formatDate(so.date)} · {so.party_name}</p>
        </div>

        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[so.status] ?? ''}`}>
          {so.status}
        </span>

        {/* Action group */}
        {canAct && !cancelPending && (
          <>
            {so.status === 'draft' && (
              <button
                onClick={handleConfirm} disabled={busy}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Confirm
              </button>
            )}
            <div className="flex items-center gap-1 rounded-lg border border-line">
              <Select
                value={convertMode}
                onChange={(e) => setConvertMode(e.target.value as typeof convertMode)}
                className="h-8 rounded-r-none border-0 border-r border-line bg-transparent pr-6 text-xs"
              >
                <option value="credit">On credit</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </Select>
              <button
                onClick={handleConvert} disabled={busy}
                className="whitespace-nowrap px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50"
              >
                Convert to Invoice
              </button>
            </div>
            <button
              onClick={() => setCancelPending(true)} disabled={busy}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-neg hover:bg-red-50"
            >
              Cancel Order
            </button>
          </>
        )}

        {/* Inline cancel confirmation */}
        {cancelPending && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-red-50 px-3 py-1.5 text-sm">
            <span className="text-neg font-medium">Cancel this order?</span>
            <button onClick={handleCancel} disabled={busy}
              className="font-semibold text-neg hover:underline">Yes, cancel</button>
            <button onClick={() => setCancelPending(false)}
              className="text-muted hover:text-ink">No</button>
          </div>
        )}

        {/* Share + print */}
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-green-600 hover:bg-canvas"
        >
          <MessageCircle size={15} /> WhatsApp
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(`Sales Order ${so.so_no}`)}&body=${encodeURIComponent(shareText)}`}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-canvas"
        >
          <Mail size={15} /> Email
        </a>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas"
        >
          <Printer size={15} /> Print / PDF
        </button>
      </div>

      {/* Inline feedback */}
      {success && (
        <div className="no-print flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          <CheckCircle2 size={15} /> {success}
        </div>
      )}
      {error && (
        <div className="no-print rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-neg">
          {error}
        </div>
      )}

      {/* Document */}
      <div className="rounded-xl bg-gray-100 p-4 print:rounded-none print:bg-white print:p-0 md:p-8">
        <div className="mx-auto max-w-3xl bg-white shadow-md print:shadow-none">
          <SalesOrderPrint so={so} />
        </div>
      </div>
    </div>
  )
}
