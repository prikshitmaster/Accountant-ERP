import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, User, MapPin, Info, FileText, Activity } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { usePartyFull, useInvoices, useBills, usePartyLedger } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { stateName } from '@/lib/states'
import { cn } from '@/lib/cn'

// ── Voucher type display map ────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  SALE: 'Invoice', PURCHASE: 'Bill', RECEIPT: 'Receipt', PAYMENT: 'Payment',
  CONTRA: 'Contra', JOURNAL: 'Journal', CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note', STOCK_JOURNAL: 'Stock Journal', OPENING: 'Opening',
}

// ── Section header ──────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</p>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  )
}

// ── Overview tab ────────────────────────────────────────────────────────────
function OverviewTab({ partyId, balance, kind }: { partyId: string; balance: number; kind: string }) {
  const { currentOrgId } = useAuth()
  const { data: party } = usePartyFull(currentOrgId, partyId)
  const { data: ledger = [] } = usePartyLedger(currentOrgId, partyId)

  const isCustomer = kind === 'customer' || kind === 'both'
  const isSupplier = kind === 'supplier' || kind === 'both'
  const outstanding = Math.abs(balance)
  // For a customer, positive balance = they owe us (receivable)
  // For a supplier, negative balance = we owe them (payable)
  const balanceLabel = isCustomer && !isSupplier ? 'Outstanding Receivables' : 'Outstanding Payables'

  const recentActivity = [...ledger].reverse().slice(0, 8)

  if (!party) return <div className="p-6 text-sm text-muted">Loading…</div>

  return (
    <div className="flex gap-0 divide-x divide-line overflow-auto">
      {/* Left — contact & details */}
      <div className="w-[300px] shrink-0 overflow-y-auto p-5">
        {/* Contact card */}
        <div className="mb-5 flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-600">
            <User size={18} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold">{party.name}</p>
            {party.email && <p className="text-xs text-muted">{party.email}</p>}
            {party.phone && <p className="text-xs text-muted">{party.phone}</p>}
            {party.contact_person && <p className="text-xs text-muted">Contact: {party.contact_person}</p>}
          </div>
        </div>

        <Section title="Address">
          {party.billing_address || party.area || party.city ? (
            <div className="flex items-start gap-2 text-sm text-muted">
              <MapPin size={13} className="mt-0.5 shrink-0 text-muted" />
              <span>
                {[party.billing_address, party.area, party.city, party.pincode].filter(Boolean).join(', ')}
                {party.state_code && ` · ${stateName(party.state_code)}`}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted">No address added.</p>
          )}
          {party.shipping_address && (
            <p className="mt-1 text-xs text-muted">Ship: {party.shipping_address}</p>
          )}
        </Section>

        <Section title="Other Details">
          <InfoRow label="GSTIN" value={party.gstin} />
          <InfoRow label="PAN" value={party.pan} />
          <InfoRow label="Group" value={party.group_name} />
          <InfoRow label="Alias" value={party.alias} />
          <InfoRow label="MSME" value={party.msme_activity} />
          <InfoRow label="Udyam No." value={party.udyam_no} />
          {party.credit_limit > 0 && (
            <InfoRow label="Credit Limit" value={formatINR(party.credit_limit)} />
          )}
          {party.credit_days > 0 && (
            <InfoRow label="Credit Days" value={`${party.credit_days} days`} />
          )}
        </Section>
      </div>

      {/* Right — balance + activity */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Balance card */}
        <Section title={balanceLabel}>
          <div className="rounded-lg border border-line bg-canvas p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted uppercase tracking-wide mb-1">INR · Indian Rupee</p>
                <p className="text-base font-semibold num">{formatINR(outstanding)}</p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide mb-1">Unused Credits</p>
                <p className="text-base font-semibold num">₹0.00</p>
              </div>
            </div>
          </div>
        </Section>

        {/* Activity timeline */}
        <Section title="Recent Activity">
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted">No transactions yet.</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((row) => (
                <div key={row.voucher_id} className="flex gap-3 text-sm">
                  <div className="flex flex-col items-center">
                    <div className="mt-1 h-2 w-2 rounded-full bg-brand-600" />
                    <div className="flex-1 w-px bg-line" />
                  </div>
                  <div className="pb-3 min-w-0">
                    <p className="font-medium text-ink">{TYPE_LABEL[row.type_code] ?? row.type_code} added</p>
                    <p className="text-xs text-muted">{row.voucher_no} · {formatDate(row.date)}</p>
                    {row.debit > 0 && (
                      <p className="text-xs text-muted">Amount: {formatINR(row.debit)}</p>
                    )}
                    {row.credit > 0 && (
                      <p className="text-xs text-muted">Payment: {formatINR(row.credit)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

// ── Transactions tab ────────────────────────────────────────────────────────
function TransactionsTab({ partyId, kind }: { partyId: string; kind: string }) {
  const { currentOrgId } = useAuth()
  const nav = useNavigate()
  const isCustomer = kind === 'customer' || kind === 'both'
  const { data: invoices = [] } = useInvoices(currentOrgId, partyId)
  const { data: bills = [] } = useBills(currentOrgId, partyId)

  return (
    <div className="p-5 space-y-6">
      {(isCustomer || kind === 'both') && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Invoices</p>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted">No invoices.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice #</th>
                  <th className="r">Amount</th>
                  <th className="r">Balance Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="cursor-pointer" onClick={() => nav(`/sales/${inv.id}`)}>
                    <td>{formatDate(inv.date)}</td>
                    <td className="font-medium text-brand-600">{inv.invoice_no}</td>
                    <td className="r num">{formatINR(inv.total)}</td>
                    <td className="r num">{formatINR(inv.outstanding)}</td>
                    <td>
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                        inv.outstanding === 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>
                        {inv.outstanding === 0 ? 'Paid' : 'Overdue'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(kind === 'supplier' || kind === 'both') && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Bills</p>
          {bills.length === 0 ? (
            <p className="text-sm text-muted">No bills.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bill #</th>
                  <th className="r">Amount</th>
                  <th className="r">Balance Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={bill.id} className="cursor-pointer" onClick={() => nav(`/purchases/${bill.id}`)}>
                    <td>{formatDate(bill.date)}</td>
                    <td className="font-medium text-brand-600">{bill.bill_no}</td>
                    <td className="r num">{formatINR(bill.total)}</td>
                    <td className="r num">{formatINR(bill.outstanding)}</td>
                    <td>
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                        bill.outstanding === 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>
                        {bill.outstanding === 0 ? 'Paid' : 'Overdue'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Statement tab ────────────────────────────────────────────────────────────
function StatementTab({ partyId, partyName }: { partyId: string; partyName: string }) {
  const { currentOrgId } = useAuth()
  const { data: ledger = [] } = usePartyLedger(currentOrgId, partyId)

  const now = new Date()
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const today = now.toISOString().slice(0, 10)

  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)

  const filtered = ledger.filter((r) => r.date >= from && r.date <= to)
  const openingEntry = ledger.filter((r) => r.date < from).at(-1)
  const openingBalance = openingEntry?.running_balance ?? 0

  const billedAmount = filtered.reduce((s, r) => s + r.debit, 0)
  const amountPaid = filtered.reduce((s, r) => s + r.credit, 0)
  const closingBalance = filtered.at(-1)?.running_balance ?? openingBalance

  return (
    <div className="p-5">
      {/* Controls */}
      <div className="no-print mb-4 flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-line px-2 py-1 text-sm" />
          <span className="text-muted">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded border border-line px-2 py-1 text-sm" />
        </div>
        <button onClick={() => window.print()}
          className="ml-auto flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm hover:bg-canvas">
          <FileText size={14} /> Print
        </button>
      </div>

      {/* Paper statement */}
      <div className="rounded-xl bg-gray-100 p-4 print:rounded-none print:bg-white print:p-0 md:p-6">
        <div className="mx-auto max-w-2xl bg-white p-8 shadow-md print:shadow-none text-sm text-black">
          {/* Title */}
          <div className="mb-6 text-center">
            <h2 className="text-lg font-bold">Statement of Accounts</h2>
            <p className="text-xs text-gray-500">
              {from.split('-').reverse().join('/')} to {to.split('-').reverse().join('/')}
            </p>
          </div>

          {/* Party */}
          <div className="mb-5">
            <p className="text-xs text-gray-500">To</p>
            <p className="font-semibold text-base">{partyName}</p>
          </div>

          {/* Summary */}
          <div className="mb-5 rounded border border-gray-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Account Summary</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Opening Balance</span>
                <span className="font-mono">{formatINR(Math.abs(openingBalance))}</span>
              </div>
              <div className="flex justify-between">
                <span>Billed Amount</span>
                <span className="font-mono">₹ {formatINR(billedAmount, false)}</span>
              </div>
              <div className="flex justify-between">
                <span>Amount Paid</span>
                <span className="font-mono">₹ {formatINR(amountPaid, false)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold">
                <span>Balance Due</span>
                <span className="font-mono">₹ {formatINR(Math.abs(closingBalance), false)}</span>
              </div>
            </div>
          </div>

          {/* Transactions */}
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-gray-800 text-left">
                <th className="py-1.5 pr-3">Date</th>
                <th className="py-1.5 pr-3">Transactions</th>
                <th className="py-1.5 pr-3">Details</th>
                <th className="py-1.5 pr-3 text-right">Amount</th>
                <th className="py-1.5 pr-3 text-right">Payments</th>
                <th className="py-1.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-1.5 pr-3">{from.split('-').reverse().join('/')}</td>
                <td className="py-1.5 pr-3 italic text-gray-500" colSpan={4}>Opening Balance</td>
                <td className="py-1.5 text-right font-mono">{formatINR(Math.abs(openingBalance), false)}</td>
              </tr>
              {filtered.map((row) => (
                <tr key={row.voucher_id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-3">{row.date.split('-').reverse().join('/')}</td>
                  <td className="py-1.5 pr-3">{TYPE_LABEL[row.type_code] ?? row.type_code}</td>
                  <td className="py-1.5 pr-3 text-gray-600">{row.voucher_no}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{row.debit > 0 ? formatINR(row.debit, false) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{row.credit > 0 ? formatINR(row.credit, false) : '—'}</td>
                  <td className="py-1.5 text-right font-mono">{formatINR(Math.abs(row.running_balance), false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-semibold">
                <td colSpan={5} className="py-2 text-right">Balance Due</td>
                <td className="py-2 text-right font-mono">₹ {formatINR(Math.abs(closingBalance), false)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── PartyDetailPanel ────────────────────────────────────────────────────────
type Props = { partyId: string; partyName: string; balance: number; kind: string; onClose: () => void }

export function PartyDetailPanel({ partyId, partyName, balance, kind, onClose }: Props) {
  const [tab, setTab] = useState<'overview' | 'transactions' | 'statement'>('overview')

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: Info },
    { key: 'transactions' as const, label: 'Transactions', icon: Activity },
    { key: 'statement' as const, label: 'Statement', icon: FileText },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="flex-1 truncate text-base font-semibold">{partyName}</h2>
        <button onClick={onClose} className="text-muted hover:text-ink">
          <X size={18} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-line px-4">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === 'overview' && <OverviewTab partyId={partyId} balance={balance} kind={kind} />}
        {tab === 'transactions' && <TransactionsTab partyId={partyId} kind={kind} />}
        {tab === 'statement' && <StatementTab partyId={partyId} partyName={partyName} />}
      </div>
    </div>
  )
}
