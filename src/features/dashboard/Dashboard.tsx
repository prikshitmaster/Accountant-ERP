import { Link } from 'react-router-dom'
import {
  TrendingUp, ShoppingCart, Wallet, Landmark, Boxes,
  ArrowDownLeft, ArrowUpRight, ReceiptText, Inbox, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDashboard, useDayBook, useItems, useGstSummary } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

export function Dashboard() {
  const { currentOrgId } = useAuth()
  const { data, isLoading } = useDashboard(currentOrgId)
  const { data: rows = [] } = useDayBook(currentOrgId, 8)
  const { data: items = [] } = useItems(currentOrgId)
  const { data: gst } = useGstSummary(currentOrgId)
  const stockValue = items.reduce((s, i) => s + i.value_on_hand, 0)
  const lowStock = items.filter((i) => i.min_level > 0 && i.qty_on_hand <= i.min_level)
  const gstNet = gst?.net_payable ?? 0

  const actions = [
    { to: '/sales', label: 'New sale', icon: TrendingUp, primary: true },
    { to: '/purchases', label: 'New purchase', icon: ShoppingCart, primary: false },
    { to: '/money', label: 'Receive / Pay', icon: Wallet, primary: false },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Home"
        description="A live snapshot of your money, stock, and what's happening in the business."
        action={
          <div className="flex flex-wrap gap-2">
            {actions.map(({ to, label, icon: Icon, primary }) => (
              <Link
                key={to}
                to={to}
                className={
                  primary
                    ? 'inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-brand-700'
                    : 'inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-canvas'
                }
              >
                <Icon size={16} /> {label}
              </Link>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 rise lg:grid-cols-3">
          <StatCard label="Cash in hand" value={formatINR(data?.cash_balance ?? 0)} icon={Wallet} sub="Physical cash" />
          <StatCard label="In the bank" value={formatINR(data?.bank_balance ?? 0)} icon={Landmark} sub="Bank balance" />
          <StatCard label="Stock value" value={formatINR(stockValue)} icon={Boxes} sub={`${items.length} item${items.length === 1 ? '' : 's'}`} />
          <StatCard label="Customers owe you" value={formatINR(data?.receivables ?? 0)} icon={ArrowDownLeft} tone="pos" sub="Money coming in" />
          <StatCard label="You owe suppliers" value={formatINR(data?.payables ?? 0)} icon={ArrowUpRight} tone="neg" sub="Money going out" />
          <StatCard
            label={gstNet >= 0 ? 'GST payable' : 'GST credit'}
            value={formatINR(Math.abs(gstNet))}
            icon={ReceiptText}
            tone={gstNet >= 0 ? 'neg' : 'pos'}
            sub={gstNet >= 0 ? 'To pay this period' : 'In your favour'}
          />
        </div>
      )}

      {lowStock.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#fcd9a5] bg-[#fffbeb] p-4">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#fef3c7] text-warn">
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {lowStock.length} item{lowStock.length === 1 ? '' : 's'} running low
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {lowStock.slice(0, 3).map((i) => i.name).join(', ')}{lowStock.length > 3 ? ', and more' : ''} — time to restock.
            </p>
          </div>
          <Link to="/stock" className="ml-auto shrink-0 self-center text-sm font-medium text-brand-600">View stock</Link>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Recent activity</h2>
          <Link to="/reports" className="text-sm font-medium text-brand-600">View day book</Link>
        </div>
        <Card className="p-0">
          {rows.length ? (
            <table className="tbl">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.voucher_id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-ink">{r.type_name}{r.party_name ? ` · ${r.party_name}` : ''}</p>
                        {r.status === 'cancelled' && <Badge tone="muted">Cancelled</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{formatDate(r.date)} · <span className="num">{r.voucher_no}</span></p>
                    </td>
                    <td className={`r num font-semibold ${r.status === 'cancelled' ? 'text-muted line-through' : 'text-ink'}`}>{formatINR(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              icon={Inbox}
              title="Nothing here yet"
              description="Your sales, purchases, and payments will show up here as you record them."
            />
          )}
        </Card>
      </div>
    </div>
  )
}
