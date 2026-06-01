import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useDashboard, useDayBook } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'pos' | 'neg' }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : ''}`}>
        {formatINR(value)}
      </p>
    </Card>
  )
}

export function Dashboard() {
  const { currentOrgId } = useAuth()
  const { data, isLoading } = useDashboard(currentOrgId)
  const { data: rows } = useDayBook(currentOrgId, 10)

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Overview</h2>

      {isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Cash in hand" value={data?.cash_balance ?? 0} />
          <Stat label="Bank balance" value={data?.bank_balance ?? 0} />
          <Stat label="Customers owe you" value={data?.receivables ?? 0} tone="pos" />
          <Stat label="You owe suppliers" value={data?.payables ?? 0} tone="neg" />
        </div>
      )}

      {(data?.low_stock_count ?? 0) > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-800">
            {data!.low_stock_count} item(s) at or below minimum stock level.
          </p>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Recent activity</h3>
        <Link to="/reports" className="text-sm text-brand-600">View all</Link>
      </div>
      <Card className="p-0">
        {rows && rows.length > 0 ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.voucher_id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {r.type_name}
                    {r.party_name ? ` · ${r.party_name}` : ''}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDate(r.date)} · {r.voucher_no}
                    {r.status === 'cancelled' && ' · cancelled'}
                  </p>
                </div>
                <span className={`text-sm font-semibold ${r.status === 'cancelled' ? 'text-muted line-through' : ''}`}>
                  {formatINR(r.amount)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted">No transactions yet.</p>
        )}
      </Card>
    </div>
  )
}
