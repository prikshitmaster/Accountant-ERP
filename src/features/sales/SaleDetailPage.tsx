import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, MessageCircle, Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useInvoiceDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { InvoicePrint } from './InvoicePrint'

export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useAuth()
  const navigate = useNavigate()
  const { data: inv, isLoading, isError } = useInvoiceDetail(currentOrgId, id ?? null)

  if (isLoading) {
    return (
      <div className="space-y-5">
        <button onClick={() => navigate('/sales')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to Sales
        </button>
        <p className="text-muted">Loading…</p>
      </div>
    )
  }

  if (isError || !inv) {
    return (
      <div className="space-y-5">
        <button onClick={() => navigate('/sales')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to Sales
        </button>
        <p className="text-neg">Invoice not found.</p>
      </div>
    )
  }

  const isPaid = inv.outstanding === 0

  const lineText = inv.lines
    .map((l) => `  ${l.item_name} × ${Number(l.qty)} @ ${formatINR(l.rate, false)} = ${formatINR(l.amount, false)}`)
    .join('\n')
  const shareText = `Invoice ${inv.invoice_no}\nCustomer: ${inv.party_name}\nDate: ${formatDate(inv.date)}\n\nItems:\n${lineText}\n\nTotal: ${formatINR(inv.total)}${inv.outstanding > 0 ? `\nDue: ${formatINR(inv.outstanding)}` : '\nStatus: Paid'}`

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigate('/sales')}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-none">{inv.invoice_no}</h1>
          <p className="mt-0.5 text-xs text-muted">{formatDate(inv.date)} · {inv.party_name}</p>
        </div>
        {isPaid
          ? <span className="badge badge-pos">Paid</span>
          : <span className="badge badge-warn">Due {formatINR(inv.outstanding, false)}</span>
        }
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-green-600 hover:bg-canvas"
        >
          <MessageCircle size={15} /> WhatsApp
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(`Invoice ${inv.invoice_no}`)}&body=${encodeURIComponent(shareText)}`}
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

      {/* Inline document — paper view */}
      <div className="rounded-xl bg-gray-100 p-4 print:rounded-none print:bg-white print:p-0 md:p-8">
        <div className="mx-auto max-w-3xl bg-white shadow-md print:shadow-none">
          <InvoicePrint inv={inv} />
        </div>
      </div>
    </div>
  )
}
