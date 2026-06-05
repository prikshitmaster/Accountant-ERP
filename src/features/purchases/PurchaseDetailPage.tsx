// src/features/purchases/PurchaseDetailPage.tsx
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, MessageCircle, Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useBillDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { PurchasePrint } from './PurchasePrint'

export function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useAuth()
  const navigate = useNavigate()
  const { data: bill, isLoading, isError } = useBillDetail(currentOrgId, id ?? null)

  if (isLoading) return <div className="text-muted p-8">Loading…</div>
  if (isError || !bill) return <div className="text-neg p-8">Bill not found. (Only bills created after the latest migration have line items.)</div>

  const isPaid = bill.outstanding === 0

  const lineText = bill.lines
    .map((l) => `  ${l.item_name} × ${Number(l.qty)} @ ${formatINR(l.rate, false)} = ${formatINR(l.amount, false)}`)
    .join('\n')
  const shareText = `Bill ${bill.bill_no}\nSupplier: ${bill.party_name}\nDate: ${formatDate(bill.date)}\n\nItems:\n${lineText}\n\nTotal: ${formatINR(bill.total)}${bill.outstanding > 0 ? `\nDue: ${formatINR(bill.outstanding)}` : '\nStatus: Paid'}`

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigate('/purchases')}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-none">{bill.bill_no}</h1>
          <p className="mt-0.5 text-xs text-muted">{formatDate(bill.date)} · {bill.party_name}</p>
        </div>
        {isPaid
          ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700">Paid</span>
          : <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">Due {formatINR(bill.outstanding, false)}</span>
        }
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-green-600 hover:bg-canvas"
        >
          <MessageCircle size={15} /> WhatsApp
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(`Bill ${bill.bill_no}`)}&body=${encodeURIComponent(shareText)}`}
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
          <PurchasePrint bill={bill} />
        </div>
      </div>
    </div>
  )
}
