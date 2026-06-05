import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { usePaymentsMade } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { ArrowUpRight } from 'lucide-react'
import { PaymentDrawer } from '@/features/money/PaymentDrawer'

const PAGE_SIZE = 20

export function PaymentsMadePage() {
  const { currentOrgId } = useAuth()
  const { data: rows = [], isLoading } = usePaymentsMade(currentOrgId)
  const [page, setPage] = useState(0)
  const [modeFilter, setModeFilter] = useState<'All' | 'Cash' | 'Bank'>('All')
  const [drawerVoucherId, setDrawerVoucherId] = useState<string | null>(null)

  const filtered = modeFilter === 'All' ? rows : rows.filter(r => r.mode === modeFilter)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const totalPaid = rows.reduce((s, r) => s + Number(r.amount), 0)
  const cashTotal = rows.filter(r => r.mode === 'Cash').reduce((s, r) => s + Number(r.amount), 0)
  const bankTotal = rows.filter(r => r.mode === 'Bank').reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-heading">Payments Made</h1>
          <p className="text-sm text-muted">Money paid to suppliers &amp; expenses</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-line bg-white px-4 py-3">
          <p className="text-xs text-muted">Total Paid</p>
          <p className="num mt-1 text-xl font-semibold text-orange-600">{formatINR(totalPaid, false)}</p>
          <p className="mt-0.5 text-xs text-muted">{rows.length} payments</p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-3">
          <p className="text-xs text-muted">By Cash</p>
          <p className="num mt-1 text-xl font-semibold text-heading">{formatINR(cashTotal, false)}</p>
          <p className="mt-0.5 text-xs text-muted">{rows.filter(r => r.mode === 'Cash').length} transactions</p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-3">
          <p className="text-xs text-muted">By Bank</p>
          <p className="num mt-1 text-xl font-semibold text-heading">{formatINR(bankTotal, false)}</p>
          <p className="mt-0.5 text-xs text-muted">{rows.filter(r => r.mode === 'Bank').length} transactions</p>
        </div>
      </div>

      <Card className="p-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex gap-1">
            {(['All', 'Cash', 'Bank'] as const).map(m => (
              <button key={m} onClick={() => { setModeFilter(m); setPage(0) }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  modeFilter === m ? 'bg-brand-600 text-white' : 'text-muted hover:bg-canvas'
                }`}>{m}</button>
            ))}
          </div>
          <span className="text-xs text-muted">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>No.</th>
                <th>Paid To</th>
                <th>Date</th>
                <th>Mode</th>
                <th>Note</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="py-10 text-center text-muted">Loading…</td></tr>}
              {!isLoading && paged.map((r) => (
                <tr key={r.voucher_id} className="cursor-pointer hover:bg-canvas" onClick={() => setDrawerVoucherId(r.voucher_id)}>
                  <td className="num text-muted">{r.voucher_no}</td>
                  <td className="font-medium">{r.party_name ?? <span className="text-muted">—</span>}</td>
                  <td className="num">{formatDate(r.date)}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      r.mode === 'Cash' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                    }`}>
                      <ArrowUpRight size={10} />{r.mode}
                    </span>
                  </td>
                  <td className="text-muted text-xs">{r.narration ?? '—'}</td>
                  <td className="r num font-semibold text-orange-600">{formatINR(Number(r.amount), false)}</td>
                </tr>
              ))}
              {!isLoading && !filtered.length && (
                <tr><td colSpan={6} className="py-10 text-center text-muted">No payments made yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
            <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">← Prev</button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">Next →</button>
            </div>
          </div>
        )}
      </Card>

      <PaymentDrawer voucherId={drawerVoucherId} type="made" onClose={() => setDrawerVoucherId(null)} />
    </div>
  )
}
