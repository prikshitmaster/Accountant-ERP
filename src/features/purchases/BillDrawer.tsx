import { useNavigate } from 'react-router-dom'
import { Printer, MessageCircle, Mail, ExternalLink } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useBillDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Drawer } from '@/components/ui/Drawer'

interface Props {
  billId: string | null
  onClose: () => void
}

export function BillDrawer({ billId, onClose }: Props) {
  const { currentOrgId } = useAuth()
  const navigate = useNavigate()
  const { data: bill, isLoading } = useBillDetail(currentOrgId, billId)

  const isPaid = bill ? bill.outstanding === 0 : false
  const shareText = bill
    ? `Bill ${bill.bill_no}\nSupplier: ${bill.party_name}\nDate: ${formatDate(bill.date)}\n\nItems:\n${
        bill.lines.map((l) => `  ${l.item_name} × ${Number(l.qty)} @ ${formatINR(l.rate, false)} = ${formatINR(l.amount, false)}`).join('\n')
      }\n\nTotal: ${formatINR(bill.total)}${bill.outstanding > 0 ? `\nDue: ${formatINR(bill.outstanding)}` : '\nStatus: Paid'}`
    : ''

  const title = bill ? (
    <div className="flex items-center gap-3 min-w-0">
      <div className="min-w-0">
        <p className="font-semibold text-heading leading-none">{bill.bill_no}</p>
        <p className="text-xs text-muted mt-0.5">{formatDate(bill.date)} · {bill.party_name}</p>
      </div>
      {isPaid
        ? <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Paid</span>
        : <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Due {formatINR(bill.outstanding, false)}</span>
      }
    </div>
  ) : null

  return (
    <Drawer open={!!billId} onClose={onClose} title={title ?? <span />}>
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-sm text-muted">Loading…</div>
      )}
      {!isLoading && !bill && (
        <div className="flex items-center justify-center py-20 text-sm text-muted">Bill not found.</div>
      )}
      {bill && (
        <div className="flex flex-col gap-0">
          {/* Line items */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted mb-2">Items</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="pb-1.5 text-left font-medium">Item</th>
                  <th className="pb-1.5 text-right font-medium">Qty</th>
                  <th className="pb-1.5 text-right font-medium">Rate</th>
                  <th className="pb-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((l, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className="py-2 text-heading">{l.item_name}</td>
                    <td className="py-2 text-right num text-muted">{Number(l.qty).toLocaleString('en-IN')}</td>
                    <td className="py-2 text-right num text-muted">{formatINR(l.rate, false)}</td>
                    <td className="py-2 text-right num font-medium">{formatINR(l.amount, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-line mx-5 pt-3 pb-4 space-y-1 text-sm">
            <div className="flex justify-between font-semibold text-base">
              <span>Total</span>
              <span className="num">{formatINR(bill.total)}</span>
            </div>
            {bill.outstanding > 0 && bill.outstanding < bill.total && (
              <div className="flex justify-between text-muted">
                <span>Paid</span>
                <span className="num text-pos">{formatINR(bill.total - bill.outstanding, false)}</span>
              </div>
            )}
            {bill.outstanding > 0 && (
              <div className="flex justify-between text-amber-600 font-medium">
                <span>Balance due</span>
                <span className="num">{formatINR(bill.outstanding, false)}</span>
              </div>
            )}
            {bill.outstanding === 0 && (
              <div className="flex justify-between text-green-600 font-medium">
                <span>Status</span>
                <span>Fully paid ✓</span>
              </div>
            )}
          </div>

          {/* Narration */}
          {bill.narration && (
            <div className="mx-5 mb-4 rounded bg-gray-50 px-3 py-2 text-xs text-muted">
              {bill.narration}
            </div>
          )}

          {/* Party / org info */}
          <div className="border-t border-line mx-5 pt-4 pb-4 grid grid-cols-2 gap-4 text-xs text-muted">
            <div>
              <p className="font-medium text-heading mb-1">{bill.party_name}</p>
              {bill.party_gstin && <p>GSTIN: {bill.party_gstin}</p>}
            </div>
            <div className="text-right">
              <p className="font-medium text-heading mb-1">{bill.org_name}</p>
              {bill.org_gstin && <p>GSTIN: {bill.org_gstin}</p>}
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-line px-5 py-4 flex flex-wrap gap-2 shrink-0 bg-gray-50">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-green-600 hover:bg-canvas"
            >
              <MessageCircle size={13} /> WhatsApp
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(`Bill ${bill.bill_no}`)}&body=${encodeURIComponent(shareText)}`}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-canvas"
            >
              <Mail size={13} /> Email
            </a>
            <button
              onClick={() => { onClose(); setTimeout(() => navigate(`/purchases/${bill.bill_id}`), 50) }}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas"
            >
              <Printer size={13} /> Print / PDF
            </button>
            <button
              onClick={() => { onClose(); setTimeout(() => navigate(`/purchases/${bill.bill_id}`), 50) }}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-muted hover:text-ink hover:bg-canvas"
            >
              <ExternalLink size={13} /> Full page
            </button>
          </div>
        </div>
      )}
    </Drawer>
  )
}
