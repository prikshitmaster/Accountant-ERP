import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Printer } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useInvoiceDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
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

  const subtotal    = inv.lines.reduce((s, l) => s + l.amount, 0)
  const taxable     = subtotal - inv.discount_amount
  const gst         = inv.total - taxable - inv.freight_amount - inv.round_off
  const isPaid      = inv.outstanding === 0

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between">
        <button
          onClick={() => navigate('/sales')}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft size={16} /> Back to Sales
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          <Printer size={16} /> Print
        </button>
      </div>

      <div className="no-print">
        <PageHeader
          title={`Invoice ${inv.invoice_no}`}
          description={`${formatDate(inv.date)} · ${inv.party_name}`}
        />
      </div>

      <div className="no-print flex items-center gap-3">
        {isPaid ? (
          <span className="badge badge-pos">Paid</span>
        ) : (
          <span className="badge badge-warn">Due {formatINR(inv.outstanding, false)}</span>
        )}
      </div>

      <Card className="no-print p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Unit</th>
                <th className="r">Qty</th>
                <th className="r">Rate (₹)</th>
                <th className="r">GST %</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
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
              <tr>
                <td colSpan={6} className="r text-sm text-muted">Subtotal</td>
                <td className="r num text-sm">{formatINR(subtotal, false)}</td>
              </tr>
              {inv.discount_amount > 0 && (
                <tr>
                  <td colSpan={6} className="r text-sm text-muted">− Discount</td>
                  <td className="r num text-sm">{formatINR(inv.discount_amount, false)}</td>
                </tr>
              )}
              {gst > 0 && (
                <tr>
                  <td colSpan={6} className="r text-sm text-muted">GST</td>
                  <td className="r num text-sm">{formatINR(gst, false)}</td>
                </tr>
              )}
              {inv.freight_amount > 0 && (
                <tr>
                  <td colSpan={6} className="r text-sm text-muted">+ Freight</td>
                  <td className="r num text-sm">{formatINR(inv.freight_amount, false)}</td>
                </tr>
              )}
              {inv.round_off !== 0 && (
                <tr>
                  <td colSpan={6} className="r text-sm text-muted">Round-off</td>
                  <td className="r num text-sm">
                    {inv.round_off > 0 ? '+' : '−'}{formatINR(Math.abs(inv.round_off), false)}
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={6} className="r text-sm font-semibold">Bill Amount</td>
                <td className="r num text-sm font-semibold">{formatINR(inv.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {inv.narration && (
        <p className="no-print text-sm text-muted">Note: {inv.narration}</p>
      )}

      <InvoicePrint inv={inv} />
    </div>
  )
}
