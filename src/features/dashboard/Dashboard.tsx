import { Link } from 'react-router-dom'
import { TrendingUp, ShoppingCart, Wallet, Landmark, Boxes, ReceiptText, Inbox, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import { useDashboard, useDayBook, useItems, useGstSummary, useAged, useMonthlyPL, useMonthlyCashFlow, useOrgSettings } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

const today = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-[#e5e7eb] my-3">
      <div className="h-1.5 rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Dashboard() {
  const { currentOrgId } = useAuth()
  const { data, isLoading } = useDashboard(currentOrgId)
  const { data: rows = [] } = useDayBook(currentOrgId, 8)
  const { data: items = [] } = useItems(currentOrgId)
  const { data: gst } = useGstSummary(currentOrgId)
  const { data: recAged = [] } = useAged(currentOrgId, 'receivables')
  const { data: payAged = [] } = useAged(currentOrgId, 'payables')
  const { data: monthly = [] } = useMonthlyPL(currentOrgId)
  const { data: cashflow = [] } = useMonthlyCashFlow(currentOrgId)
  const { data: settings } = useOrgSettings(currentOrgId)

  const stockValue = items.reduce((s, i) => s + i.value_on_hand, 0)
  const lowStock = items.filter((i) => i.min_level > 0 && i.qty_on_hand <= i.min_level)
  const gstNet = gst?.net_payable ?? 0

  // Receivables breakdown
  const recCurrent  = recAged.reduce((s, r) => s + r.b_0_30, 0)
  const recOverdue  = recAged.reduce((s, r) => s + r.b_31_60 + r.b_61_90 + r.b_90_plus, 0)
  const recTotal    = data?.receivables ?? 0

  // Payables breakdown
  const payCurrent  = payAged.reduce((s, r) => s + r.b_0_30, 0)
  const payOverdue  = payAged.reduce((s, r) => s + r.b_31_60 + r.b_61_90 + r.b_90_plus, 0)
  const payTotal    = data?.payables ?? 0

  // Chart data — convert paise to rupees for readable axis
  const chartData = monthly.map((m) => ({
    month: new Date(m.month).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    income:  Math.round(m.income / 100),
    expense: Math.round(m.expense / 100),
  }))

  const totalIncome  = monthly.reduce((s, m) => s + m.income,  0)
  const totalExpense = monthly.reduce((s, m) => s + m.expense, 0)

  const totalIncoming = cashflow.reduce((s, m) => s + m.incoming, 0)
  const totalOutgoing  = cashflow.reduce((s, m) => s + m.outgoing,  0)
  const openingCash    = (data?.cash_balance ?? 0) + (data?.bank_balance ?? 0) - (totalIncoming - totalOutgoing)
  const closingCash    = (data?.cash_balance ?? 0) + (data?.bank_balance ?? 0)

  const cashChartData = cashflow.map((m) => ({
    month:    new Date(m.month).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    incoming: Math.round(m.incoming / 100),
    outgoing: Math.round(m.outgoing / 100),
  }))

  const orgName = settings?.business_name ?? 'your business'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Hello, {orgName}</h1>
          <p className="text-sm text-muted mt-0.5">{today()}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/sales" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <TrendingUp size={14} /> New sale
          </Link>
          <Link to="/purchases" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-canvas">
            <ShoppingCart size={14} /> New purchase
          </Link>
        </div>
      </div>

      {/* Receivables + Payables */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Receivables */}
        <Card>
          <div className="flex items-center justify-between mb-1">
            <p className="font-semibold text-ink">Total Receivables</p>
            <Link to="/sales" className="text-xs text-brand-600 font-medium">+ New</Link>
          </div>
          <p className="text-xs text-muted">Total Unpaid Invoices</p>
          <p className="text-2xl font-bold text-ink mt-1">{formatINR(recTotal)}</p>
          <ProgressBar value={recTotal} max={recTotal + payTotal || 1} />
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-brand-600" />
              Current · {formatINR(recCurrent, false)}
            </span>
            <span className="flex items-center gap-1 text-warn">
              <span className="inline-block h-2 w-2 rounded-full bg-warn" />
              Overdue · {formatINR(recOverdue, false)}
            </span>
          </div>
        </Card>

        {/* Payables */}
        <Card>
          <div className="flex items-center justify-between mb-1">
            <p className="font-semibold text-ink">Total Payables</p>
            <Link to="/purchases" className="text-xs text-brand-600 font-medium">+ New</Link>
          </div>
          <p className="text-xs text-muted">Total Unpaid Bills</p>
          <p className="text-2xl font-bold text-ink mt-1">{formatINR(payTotal)}</p>
          <ProgressBar value={payTotal} max={recTotal + payTotal || 1} />
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-brand-600" />
              Current · {formatINR(payCurrent, false)}
            </span>
            <span className="flex items-center gap-1 text-warn">
              <span className="inline-block h-2 w-2 rounded-full bg-warn" />
              Overdue · {formatINR(payOverdue, false)}
            </span>
          </div>
        </Card>
      </div>

      {/* Cash Flow Chart */}
      <Card>
        <div className="flex items-start justify-between mb-4">
          <p className="font-semibold text-ink">Cash Flow</p>
          <span className="text-xs text-muted">This Fiscal Year</span>
        </div>
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            {cashChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={cashChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                  <Tooltip formatter={(v) => [`₹${Number(v ?? 0).toLocaleString('en-IN')}`, '']} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Area type="monotone" dataKey="incoming" name="Incoming" stroke="#22c55e" fill="url(#incGrad)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="outgoing"  name="Outgoing"  stroke="#ef4444" fill="url(#outGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted">No cash transactions yet.</div>
            )}
          </div>
          {/* Right legend */}
          <div className="w-44 shrink-0 space-y-4 text-right text-sm">
            <div>
              <p className="text-xs text-muted flex items-center justify-end gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]" /> Opening Cash
              </p>
              <p className="font-semibold text-ink num">{formatINR(Math.max(0, openingCash))}</p>
            </div>
            <div>
              <p className="text-xs text-muted flex items-center justify-end gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#22c55e]" /> Incoming
              </p>
              <p className="font-semibold text-[#22c55e] num">{formatINR(totalIncoming, false)} ( + )</p>
            </div>
            <div>
              <p className="text-xs text-muted flex items-center justify-end gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" /> Outgoing
              </p>
              <p className="font-semibold text-[#ef4444] num">{formatINR(totalOutgoing, false)} ( − )</p>
            </div>
            <div className="border-t border-line pt-3">
              <p className="text-xs text-muted flex items-center justify-end gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-brand-600" /> Closing Cash
              </p>
              <p className="font-semibold text-ink num">{formatINR(closingCash, false)} ( = )</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Income & Expense Chart */}
      <Card>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-semibold text-ink">Income and Expense</p>
            <div className="flex items-center gap-4 mt-1.5 text-xs">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#22c55e]" />
                <span className="text-muted">Total Income</span>
                <span className="font-medium text-ink ml-1">{formatINR(totalIncome, false)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" />
                <span className="text-muted">Total Expenses</span>
                <span className="font-medium text-ink ml-1">{formatINR(totalExpense, false)}</span>
              </span>
            </div>
          </div>
          <span className="text-xs text-muted">This Fiscal Year</span>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
              <Tooltip formatter={(v) => [`₹${Number(v ?? 0).toLocaleString('en-IN')}`, '']} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <Bar dataKey="income"  name="Income"  fill="#22c55e" radius={[3,3,0,0]} maxBarSize={32} />
              <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[3,3,0,0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted">No data yet — record a sale or expense to see your chart.</div>
        )}
      </Card>

      {/* Stat Cards Row */}
      {!isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: 'Cash in hand', value: formatINR(data?.cash_balance ?? 0), icon: Wallet, sub: 'Physical cash' },
            { label: 'Bank balance',  value: formatINR(data?.bank_balance ?? 0),  icon: Landmark, sub: 'In the bank' },
            { label: 'Stock value',   value: formatINR(stockValue),               icon: Boxes,   sub: `${items.length} items` },
          ].map(({ label, value, icon: Icon, sub }) => (
            <Card key={label} className="flex items-center gap-3 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Icon size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted truncate">{label}</p>
                <p className="font-semibold text-sm text-ink num">{value}</p>
                <p className="text-xs text-muted">{sub}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* GST + Low stock */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600"><ReceiptText size={15} /></span>
            <p className="font-semibold text-sm">GST Summary</p>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted">Output tax</span><span className="num">{formatINR(gst?.output_tax ?? 0, false)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Input credit</span><span className="num">{formatINR(gst?.input_credit ?? 0, false)}</span></div>
            <div className="flex justify-between border-t border-line pt-1 font-medium"><span className={gstNet >= 0 ? 'text-neg' : 'text-pos'}>{gstNet >= 0 ? 'Net payable' : 'Net credit'}</span><span className="num">{formatINR(Math.abs(gstNet), false)}</span></div>
          </div>
        </Card>

        {lowStock.length > 0 ? (
          <div className="flex items-start gap-3 rounded-2xl border border-[#fcd9a5] bg-[#fffbeb] p-4">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#fef3c7] text-warn"><AlertTriangle size={17} /></span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{lowStock.length} item{lowStock.length === 1 ? '' : 's'} running low</p>
              <p className="mt-0.5 text-xs text-muted">{lowStock.slice(0, 3).map((i) => i.name).join(', ')}{lowStock.length > 3 ? ', and more' : ''}</p>
            </div>
            <Link to="/stock" className="ml-auto shrink-0 self-center text-xs font-medium text-brand-600">View</Link>
          </div>
        ) : (
          <Card className="flex items-center justify-center text-sm text-muted">All stock levels are healthy.</Card>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Recent Activity</h2>
          <Link to="/reports" className="text-sm font-medium text-brand-600">View all</Link>
        </div>
        <Card className="p-0">
          {rows.length ? (
            <table className="tbl">
              <thead><tr><th>Transaction</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.voucher_id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-ink text-sm">{r.type_name}{r.party_name ? ` · ${r.party_name}` : ''}</p>
                        {r.status === 'cancelled' && <Badge tone="muted">Cancelled</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{formatDate(r.date)} · <span className="num">{r.voucher_no}</span></p>
                    </td>
                    <td className={`r num font-semibold text-sm ${r.status === 'cancelled' ? 'text-muted line-through' : 'text-ink'}`}>{formatINR(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={Inbox} title="Nothing here yet" description="Your sales, purchases, and payments will show up here." />
          )}
        </Card>
      </div>
    </div>
  )
}
