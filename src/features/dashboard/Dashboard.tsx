import { Link } from 'react-router-dom'
import { TrendingUp, ShoppingCart, Wallet } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDashboard, useDayBook, useItems, useGstSummary } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'

function Stat({ label, value, tone, sub }: { label: string; value: number; tone?: 'pos' | 'neg'; sub?: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`num mt-1 text-lg font-semibold ${tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : ''}`}>
        {formatINR(value)}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Card>
  )
}

export function Dashboard() {
  const { currentOrgId } = useAuth()
  const { data, isLoading } = useDashboard(currentOrgId)
  const { data: rows = [] } = useDayBook(currentOrgId, 8)
  const { data: items = [] } = useItems(currentOrgId)
  const { data: gst } = useGstSummary(currentOrgId)
  const stockValue = items.reduce((s, i) => s + i.value_on_hand, 0)
  const lowStock = items.filter((i) => i.min_level > 0 && i.qty_on_hand <= i.min_level)

  const actions = [
    { to: '/sales', label: 'New sale', icon: TrendingUp },
    { to: '/purchases', label: 'New purchase', icon: ShoppingCart },
    { to: '/money', label: 'Receive / Pay', icon: Wallet },
  ]

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Overview</h2>

      <div className="flex flex-wrap gap-2">
        {actions.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
            <Icon size={16} /> {label}
          </Link>
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Cash in hand" value={data?.cash_balance ?? 0} />
          <Stat label="Bank balance" value={data?.bank_balance ?? 0} />
          <Stat label="Stock value" value={stockValue} />
          <Stat label="Customers owe you" value={data?.receivables ?? 0} tone="pos" />
          <Stat label="You owe suppliers" value={data?.payables ?? 0} tone="neg" />
          <Stat
            label={(gst?.net_payable ?? 0) >= 0 ? 'GST payable' : 'GST credit'}
            value={Math.abs(gst?.net_payable ?? 0)}
            tone={(gst?.net_payable ?? 0) >= 0 ? 'neg' : 'pos'}
          />
        </div>
      )}

      {lowStock.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="text-sm text-warn">
            {lowStock.length} item(s) low on stock: {lowStock.slice(0, 3).map((i) => i.name).join(', ')}
            {lowStock.length > 3 ? '…' : ''}
          </p>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Recent activity</h3>
        <Link to="/reports" className="text-sm text-brand-600">View day book</Link>
      </div>
      <Card className="p-0">
        <table className="tbl">
          <tbody>
            {rows.map((r) => (
              <tr key={r.voucher_id}>
                <td>
                  <p className="font-medium">{r.type_name}{r.party_name ? ` · ${r.party_name}` : ''}</p>
                  <p className="text-xs text-muted">{formatDate(r.date)} · <span className="num">{r.voucher_no}</span>{r.status === 'cancelled' ? ' · cancelled' : ''}</p>
                </td>
                <td className={`r num font-medium ${r.status === 'cancelled' ? 'text-muted line-through' : ''}`}>{formatINR(r.amount)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td className="py-6 text-center text-muted">No transactions yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
