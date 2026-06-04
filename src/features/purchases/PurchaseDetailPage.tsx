// src/features/purchases/PurchaseDetailPage.tsx
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useBillDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { PurchasePrint } from './PurchasePrint'

export function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useAuth()
  const navigate = useNavigate()
  const { data: bill, isLoading, isError } = useBillDetail(currentOrgId, id ?? null)

  if (isLoading) return <div className="text-muted p-8">Loading…</div>
  if (isError || !bill) return <div className="text-neg p-8">Bill not found. (Only bills created after the latest migration have line items.)</div>

  const subtotal = bill.lines.reduce((s, l) => s + l.amount, 0)
  const gst = bill.total - subtotal
  const isPaid = bill.outstanding === 0

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between">
        <button onClick={() => navigate('/purchases')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to Purchases
        </button>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
          <Printer size={16} /> Print
        </button>
      </div>

      <div className="no-print">
        <h1 className="text-xl font-semibold">Bill {bill.bill_no}</h1>
        <p className="text-sm text-muted">{formatDate(bill.date)} · {bill.party_name}</p>
      </div>

      <div className="no-print flex items-center gap-3">
        {isPaid
          ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700">Paid</span>
          : <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">Due {formatINR(bill.outstanding, false)}</span>
        }
      </div>

      <Card className="no-print p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Item</th><th>Unit</th><th className="r">Qty</th><th className="r">Rate (₹)</th><th className="r">GST %</th><th className="r">Amount</th></tr>
            </thead>
            <tbody>
              {bill.lines.map((l, i) => (
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
              <tr><td colSpan={6} className="r text-sm text-muted">Subtotal</td><td className="r num text-sm">{formatINR(subtotal, false)}</td></tr>
              {gst > 0 && (
                <tr><td colSpan={6} className="r text-sm text-muted">GST</td><td className="r num text-sm">{formatINR(gst, false)}</td></tr>
              )}
              <tr><td colSpan={6} className="r text-sm font-semibold">Bill Amount</td><td className="r num text-sm font-semibold">{formatINR(bill.total)}</td></tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {bill.narration && <p className="no-print text-sm text-muted">Note: {bill.narration}</p>}

      <PurchasePrint bill={bill} />
    </div>
  )
}
