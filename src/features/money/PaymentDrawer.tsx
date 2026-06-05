import { useNavigate } from 'react-router-dom'
import { Printer, Mail, MessageCircle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { usePaymentDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Drawer } from '@/components/ui/Drawer'

// Indian number-to-words
function toWords(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  function chunk(n: number): string {
    if (n === 0) return ''
    if (n < 20) return ones[n] + ' '
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '') + ' '
    return ones[Math.floor(n/100)] + ' Hundred ' + chunk(n%100)
  }
  if (rupees === 0) return 'Zero Rupees Only'
  let w = ''
  const cr = Math.floor(rupees / 10000000); if (cr) w += chunk(cr) + 'Crore '
  const lac = Math.floor((rupees % 10000000) / 100000); if (lac) w += chunk(lac) + 'Lakh '
  const th = Math.floor((rupees % 100000) / 1000); if (th) w += chunk(th) + 'Thousand '
  const rest = rupees % 1000; if (rest) w += chunk(rest)
  return 'Indian Rupee ' + w.trim() + ' Only'
}

interface Props {
  voucherId: string | null
  type: 'received' | 'made'
  onClose: () => void
}

export function PaymentDrawer({ voucherId, type, onClose }: Props) {
  const { currentOrgId } = useAuth()
  const { data: pmt, isLoading } = usePaymentDetail(currentOrgId, voucherId)

  const isReceipt = type === 'received'
  const docTitle = isReceipt ? 'PAYMENT RECEIVED' : 'PAYMENT MADE'
  const partyLabel = isReceipt ? 'Received From' : 'Paid To'
  const amtLabel = isReceipt ? 'Amount Received' : 'Amount Paid'
  const amtColor = isReceipt ? 'bg-emerald-600' : 'bg-orange-500'

  const shareText = pmt
    ? `${docTitle}\n${partyLabel}: ${pmt.party_name ?? '—'}\nDate: ${formatDate(pmt.date)}\nAmount: ${formatINR(Number(pmt.amount))}\nMode: ${pmt.mode}\n${pmt.narration ? 'Note: ' + pmt.narration : ''}`
    : ''

  const drawerTitle = pmt ? (
    <div>
      <p className="font-semibold text-heading leading-none">{pmt.voucher_no}</p>
      <p className="text-xs text-muted mt-0.5">{formatDate(pmt.date)} · {pmt.party_name ?? '—'}</p>
    </div>
  ) : null

  return (
    <Drawer open={!!voucherId} onClose={onClose} title={drawerTitle ?? <span />} width="w-[520px]">
      {isLoading && <div className="flex items-center justify-center py-20 text-sm text-muted">Loading…</div>}
      {!isLoading && !pmt && <div className="flex items-center justify-center py-20 text-sm text-muted">Not found.</div>}
      {pmt && (
        <div className="flex flex-col">
          {/* Paper document */}
          <div className="mx-4 mt-4 mb-2 rounded-lg border border-line bg-white shadow-sm overflow-hidden">
            {/* Doc header */}
            <div className="px-6 pt-6 pb-4 border-b border-line">
              <p className="text-base font-bold text-heading">Demo Traders</p>
              <p className="text-xs text-muted mt-0.5">GST Registered Business</p>
            </div>

            {/* Title + amount box */}
            <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">{docTitle}</p>
                <p className="num mt-3 text-2xl font-bold text-heading">{formatINR(Number(pmt.amount))}</p>
              </div>
              <div className={`${amtColor} rounded-lg px-4 py-3 text-white text-right min-w-[130px]`}>
                <p className="text-[10px] font-medium uppercase tracking-wide opacity-80">{amtLabel}</p>
                <p className="num mt-1 text-lg font-bold">{formatINR(Number(pmt.amount), false)}</p>
              </div>
            </div>

            {/* Details grid */}
            <div className="px-6 pb-4 space-y-0 divide-y divide-line/50 border-t border-line">
              {[
                { label: 'Payment #',     value: pmt.voucher_no },
                { label: 'Date',          value: formatDate(pmt.date) },
                { label: partyLabel,      value: pmt.party_name ?? '—', blue: true },
                { label: 'Payment Mode',  value: pmt.mode },
                { label: 'Amount in Words', value: toWords(Number(pmt.amount)), small: true },
                ...(pmt.narration ? [{ label: 'Note', value: pmt.narration, small: true }] : []),
              ].map(({ label, value, blue, small }) => (
                <div key={label} className="flex items-baseline gap-4 py-2.5">
                  <span className="w-36 shrink-0 text-xs text-muted">{label}</span>
                  <span className={`flex-1 text-sm font-medium ${blue ? 'text-brand-600' : 'text-heading'} ${small ? 'text-xs font-normal' : ''}`}>{value}</span>
                </div>
              ))}
            </div>

            {/* Journal entries */}
            <div className="px-6 pb-5 pt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Journal</p>
              <table className="w-full text-xs border border-line rounded overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted">Account</th>
                    <th className="px-3 py-2 text-right font-medium text-muted">Debit</th>
                    <th className="px-3 py-2 text-right font-medium text-muted">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {pmt.lines.map((l, i) => (
                    <tr key={i} className="border-t border-line/50">
                      <td className="px-3 py-2 text-heading">{l.account_name}</td>
                      <td className="px-3 py-2 text-right num">{l.debit > 0 ? formatINR(l.debit, false) : '—'}</td>
                      <td className="px-3 py-2 text-right num">{l.credit > 0 ? formatINR(l.credit, false) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-muted">Total</td>
                    <td className="px-3 py-2 text-right num">{formatINR(pmt.lines.reduce((s,l)=>s+l.debit,0), false)}</td>
                    <td className="px-3 py-2 text-right num">{formatINR(pmt.lines.reduce((s,l)=>s+l.credit,0), false)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-line px-4 py-3 flex gap-2 bg-gray-50">
            <a href={`mailto:?subject=${encodeURIComponent(docTitle + ' ' + pmt.voucher_no)}&body=${encodeURIComponent(shareText)}`}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-canvas">
              <Mail size={13} /> Email
            </a>
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-green-600 hover:bg-canvas">
              <MessageCircle size={13} /> WhatsApp
            </a>
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas">
              <Printer size={13} /> Print
            </button>
          </div>
        </div>
      )}
    </Drawer>
  )
}
