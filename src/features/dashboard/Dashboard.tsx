import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, ShoppingCart, Wallet, Landmark, Boxes, ReceiptText, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import { useDashboard, useItems, useGstSummary, useAged, useMonthlyPL, useMonthlyCashFlow, useOrgSettings, useCustomerBreakdown } from '@/hooks/queries'
import { formatINR } from '@/lib/money'
import { Card } from '@/components/ui/Card'

const today = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

function currentFY(): string {
  const now = new Date()
  const y = now.getFullYear()
  return now.getMonth() >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`
}

function fyRange(fy: string): { from: string; to: string; label: string } {
  const [startY] = fy.split('-').map(Number)
  return {
    from:  `${startY}-04-01`,
    to:    `${startY + 1}-03-31`,
    label: `FY ${startY}-${String(startY + 1).slice(2)}`,
  }
}

function buildFYOptions(): string[] {
  const now = new Date()
  const y = now.getFullYear()
  const curStartY = now.getMonth() >= 3 ? y : y - 1
  return [curStartY - 2, curStartY - 1, curStartY].map(
    (s) => `${s}-${String(s + 1).slice(2)}`
  )
}

type MonthOption = { key: string; label: string; from: string; to: string }

function fyMonths(fy: string): MonthOption[] {
  const [startY] = fy.split('-').map(Number)
  const slots = [
    [3, startY], [4, startY], [5, startY], [6, startY], [7, startY], [8, startY],
    [9, startY], [10, startY], [11, startY], [0, startY + 1], [1, startY + 1], [2, startY + 1],
  ] as [number, number][]
  return slots.map(([m, y]) => {
    const lastDay = new Date(y, m + 1, 0).getDate()
    const mm = String(m + 1).padStart(2, '0')
    return {
      key:   `${y}-${mm}`,
      label: new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      from:  `${y}-${mm}-01`,
      to:    `${y}-${mm}-${lastDay}`,
    }
  })
}

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
  const [fy, setFy] = useState(currentFY)
  const [monthKey, setMonthKey] = useState<string | null>(null)
  const fyOpts   = buildFYOptions()
  const months   = fyMonths(fy)
  const fyFull   = fyRange(fy)
  const selMonth = months.find((m) => m.key === monthKey) ?? null

  const effectiveFrom  = selMonth ? selMonth.from  : fyFull.from
  const effectiveTo    = selMonth ? selMonth.to    : fyFull.to
  const periodLabel    = selMonth ? selMonth.label : fyFull.label

  useEffect(() => { setMonthKey(null) }, [fy])

  const { data, isLoading } = useDashboard(currentOrgId)
  const { data: items = [] } = useItems(currentOrgId)
  const { data: gst } = useGstSummary(currentOrgId)
  const { data: recAged = [] } = useAged(currentOrgId, 'receivables')
  const { data: payAged = [] } = useAged(currentOrgId, 'payables')
  const { data: monthly = [] } = useMonthlyPL(currentOrgId, effectiveFrom, effectiveTo)
  const { data: cashflow = [] } = useMonthlyCashFlow(currentOrgId, effectiveFrom, effectiveTo)
  const { data: settings } = useOrgSettings(currentOrgId)
  const { data: custBreakdown = [] } = useCustomerBreakdown(currentOrgId, effectiveFrom, effectiveTo)

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

      {/* Filter bar */}
      <div className="space-y-2">
        {/* FY row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted w-16 shrink-0">Fiscal Year</span>
          {fyOpts.map((f) => {
            const { label } = fyRange(f)
            return (
              <button
                key={f}
                onClick={() => setFy(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  f === fy
                    ? 'bg-brand-600 text-white'
                    : 'border border-line bg-white text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        {/* Month row */}
        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto pb-1">
          <span className="text-xs text-muted w-16 shrink-0">Month</span>
          <button
            onClick={() => setMonthKey(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !monthKey
                ? 'bg-brand-600 text-white'
                : 'border border-line bg-white text-muted hover:text-ink'
            }`}
          >
            All
          </button>
          {months.map((m) => (
            <button
              key={m.key}
              onClick={() => setMonthKey(m.key === monthKey ? null : m.key)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                m.key === monthKey
                  ? 'bg-brand-600 text-white'
                  : 'border border-line bg-white text-muted hover:text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
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
          <span className="text-xs text-muted">{periodLabel}</span>
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
          <span className="text-xs text-muted">{periodLabel}</span>
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

      {/* Customer Breakdown */}
      {custBreakdown.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-ink">Sales by Customer</p>
            <span className="text-xs text-muted">{periodLabel}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="pb-2 text-left font-medium">Customer</th>
                  <th className="pb-2 text-right font-medium">Sales</th>
                  <th className="pb-2 text-right font-medium">Outstanding</th>
                  <th className="pb-2 text-right font-medium">Invoices</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {custBreakdown.map((row) => (
                  <tr key={row.party_name} className="hover:bg-canvas transition-colors">
                    <td className="py-2 font-medium text-ink">{row.party_name}</td>
                    <td className="py-2 text-right num">{formatINR(row.sales, false)}</td>
                    <td className={`py-2 text-right num ${row.outstanding > 0 ? 'text-warn' : 'text-muted'}`}>
                      {row.outstanding > 0 ? formatINR(row.outstanding, false) : '—'}
                    </td>
                    <td className="py-2 text-right text-muted">{row.invoices}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line text-xs font-semibold">
                  <td className="pt-2">Total</td>
                  <td className="pt-2 text-right num">{formatINR(custBreakdown.reduce((s, r) => s + r.sales, 0), false)}</td>
                  <td className="pt-2 text-right num text-warn">{formatINR(custBreakdown.reduce((s, r) => s + r.outstanding, 0), false)}</td>
                  <td className="pt-2 text-right text-muted">{custBreakdown.reduce((s, r) => s + r.invoices, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

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
    </div>
  )
}
