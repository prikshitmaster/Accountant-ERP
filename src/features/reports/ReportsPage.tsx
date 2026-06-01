import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useDayBook, useParties, usePartyLedger, useAged, useGstSummary, useProfitLoss, useBalanceSheet } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Input'

type Tab = 'tb' | 'pl' | 'bs' | 'daybook' | 'ledger' | 'receivables' | 'payables' | 'gst'
type TBRow = { account_id: string; account_name: string; closing_debit: number; closing_credit: number }

function useTrialBalance(orgId: string | null) {
  return useQuery({
    queryKey: ['trial_balance', orgId], enabled: !!orgId,
    queryFn: async (): Promise<TBRow[]> => {
      const { data, error } = await supabase.from('v_trial_balance')
        .select('account_id, account_name, closing_debit, closing_credit').eq('org_id', orgId).order('account_name')
      if (error) throw error
      return (data ?? []) as TBRow[]
    },
  })
}

export function ReportsPage() {
  const { currentOrgId } = useAuth()
  const [params, setParams] = useSearchParams()
  const initial: Tab = params.get('ledger') ? 'ledger' : 'tb'
  const [tab, setTab] = useState<Tab>(initial)

  const TABS: [Tab, string][] = [
    ['pl', 'Profit & Loss'], ['bs', 'Balance Sheet'], ['tb', 'Trial Balance'],
    ['daybook', 'Day Book'], ['ledger', 'Party Ledger'],
    ['receivables', 'Receivables'], ['payables', 'Payables'], ['gst', 'GST'],
  ]

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Reports</h2>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-full px-3.5 py-1.5 text-sm ${tab === id ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'pl' && <ProfitLoss orgId={currentOrgId} />}
      {tab === 'bs' && <BalanceSheet orgId={currentOrgId} />}
      {tab === 'tb' && <TrialBalance orgId={currentOrgId} />}
      {tab === 'daybook' && <DayBook orgId={currentOrgId} />}
      {tab === 'ledger' && <PartyLedger orgId={currentOrgId} initialParty={params.get('ledger')} onParty={(id) => setParams(id ? { ledger: id } : {})} />}
      {tab === 'receivables' && <Aged orgId={currentOrgId} kind="receivables" />}
      {tab === 'payables' && <Aged orgId={currentOrgId} kind="payables" />}
      {tab === 'gst' && <Gst orgId={currentOrgId} />}
    </div>
  )
}

function TrialBalance({ orgId }: { orgId: string | null }) {
  const { data: tb = [] } = useTrialBalance(orgId)
  const dr = tb.reduce((s, r) => s + r.closing_debit, 0)
  const cr = tb.reduce((s, r) => s + r.closing_credit, 0)
  return (
    <Card className="p-0">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
          <tbody>
            {tb.map((r) => (
              <tr key={r.account_id}>
                <td>{r.account_name}</td>
                <td className="r num">{r.closing_debit ? formatINR(r.closing_debit, false) : '—'}</td>
                <td className="r num">{r.closing_credit ? formatINR(r.closing_credit, false) : '—'}</td>
              </tr>
            ))}
            {!tb.length && <tr><td colSpan={3} className="py-6 text-center text-muted">No entries yet.</td></tr>}
          </tbody>
          {tb.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td className={dr === cr ? 'text-pos' : 'text-neg'}>{dr === cr ? 'Balanced' : 'NOT balanced'}</td>
                <td className="r num">{formatINR(dr, false)}</td>
                <td className="r num">{formatINR(cr, false)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  )
}

function Section({ title, rows, total }: { title: string; rows: { account_name: string; v: number }[]; total: number }) {
  return (
    <>
      <tr className="bg-paper"><td className="font-semibold uppercase tracking-wide text-muted" colSpan={2} style={{ fontSize: 11 }}>{title}</td></tr>
      {rows.map((r, i) => (
        <tr key={i}><td className="pl-6">{r.account_name}</td><td className="r num">{formatINR(r.v, false)}</td></tr>
      ))}
      <tr className="font-semibold"><td className="pl-3">Total {title}</td><td className="r num">{formatINR(total, false)}</td></tr>
    </>
  )
}

function ProfitLoss({ orgId }: { orgId: string | null }) {
  const { data = [] } = useProfitLoss(orgId)
  const income = data.filter((r) => r.group_id === 4).map((r) => ({ account_name: r.account_name, v: r.amount ?? 0 }))
  const expense = data.filter((r) => r.group_id === 5).map((r) => ({ account_name: r.account_name, v: r.amount ?? 0 }))
  const ti = income.reduce((s, r) => s + r.v, 0)
  const te = expense.reduce((s, r) => s + r.v, 0)
  const net = ti - te
  return (
    <Card className="p-0">
      <table className="tbl">
        <tbody>
          <Section title="Income" rows={income} total={ti} />
          <Section title="Expenses (incl. COGS)" rows={expense} total={te} />
          <tr className="border-t-2 border-line text-base font-bold">
            <td>{net >= 0 ? 'Net Profit' : 'Net Loss'}</td>
            <td className={`r num ${net >= 0 ? 'text-pos' : 'text-neg'}`}>{formatINR(Math.abs(net), false)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  )
}

function BalanceSheet({ orgId }: { orgId: string | null }) {
  const { data: bs = [] } = useBalanceSheet(orgId)
  const { data: pl = [] } = useProfitLoss(orgId)
  const net = pl.filter((r) => r.group_id === 4).reduce((s, r) => s + (r.amount ?? 0), 0)
    - pl.filter((r) => r.group_id === 5).reduce((s, r) => s + (r.amount ?? 0), 0)
  const assets = bs.filter((r) => r.group_id === 1).map((r) => ({ account_name: r.account_name, v: r.balance ?? 0 }))
  const liabilities = bs.filter((r) => r.group_id === 2).map((r) => ({ account_name: r.account_name, v: r.balance ?? 0 }))
  const equity = bs.filter((r) => r.group_id === 3).map((r) => ({ account_name: r.account_name, v: r.balance ?? 0 }))
  equity.push({ account_name: net >= 0 ? 'Current-year profit' : 'Current-year loss', v: net })
  const ta = assets.reduce((s, r) => s + r.v, 0)
  const tl = liabilities.reduce((s, r) => s + r.v, 0)
  const teq = equity.reduce((s, r) => s + r.v, 0)
  const balanced = ta === tl + teq
  return (
    <Card className="p-0">
      <table className="tbl">
        <tbody>
          <Section title="Assets" rows={assets} total={ta} />
          <Section title="Liabilities" rows={liabilities} total={tl} />
          <Section title="Equity" rows={equity} total={teq} />
          <tr className="border-t-2 border-line font-bold">
            <td className={balanced ? 'text-pos' : 'text-neg'}>{balanced ? 'Balanced ✓' : 'Out of balance'}</td>
            <td className="r num">A {formatINR(ta, false)} = L+E {formatINR(tl + teq, false)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  )
}

function DayBook({ orgId }: { orgId: string | null }) {
  const { data: rows = [] } = useDayBook(orgId, 100)
  return (
    <Card className="p-0">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Voucher</th><th>Type</th><th>Party</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.voucher_id}>
                <td className="num">{formatDate(r.date)}</td>
                <td className="num">{r.voucher_no}</td>
                <td>{r.type_name}{r.status === 'cancelled' ? ' (cancelled)' : ''}</td>
                <td>{r.party_name ?? '—'}</td>
                <td className={`r num ${r.status === 'cancelled' ? 'text-muted line-through' : ''}`}>{formatINR(r.amount, false)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-muted">No transactions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function PartyLedger({ orgId, initialParty, onParty }: {
  orgId: string | null; initialParty: string | null; onParty: (id: string) => void
}) {
  const { data: parties = [] } = useParties(orgId)
  const [party, setParty] = useState(initialParty ?? '')
  const { data: rows = [] } = usePartyLedger(orgId, party || null)
  return (
    <div className="space-y-3">
      <Select className="max-w-xs" value={party} onChange={(e) => { setParty(e.target.value); onParty(e.target.value) }}>
        <option value="" disabled>Select a party…</option>
        {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      {party && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Voucher</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.voucher_id + i}>
                    <td className="num">{formatDate(r.date)}</td>
                    <td className="num">{r.voucher_no}</td>
                    <td className="r num">{r.debit ? formatINR(r.debit, false) : '—'}</td>
                    <td className="r num">{r.credit ? formatINR(r.credit, false) : '—'}</td>
                    <td className="r num">{formatINR(Math.abs(r.running_balance), false)} {r.running_balance >= 0 ? 'Dr' : 'Cr'}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-muted">No transactions.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function Aged({ orgId, kind }: { orgId: string | null; kind: 'receivables' | 'payables' }) {
  const { data: rows = [] } = useAged(orgId, kind)
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)
  return (
    <Card className="p-0">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Party</th><th>Doc</th><th className="r">0–30</th><th className="r">31–60</th><th className="r">61–90</th><th className="r">90+</th><th className="r">Total</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.party_name}</td>
                <td className="num">{r.invoice_no ?? r.bill_no}</td>
                <td className="r num">{r.b_0_30 ? formatINR(r.b_0_30, false) : '—'}</td>
                <td className="r num">{r.b_31_60 ? formatINR(r.b_31_60, false) : '—'}</td>
                <td className="r num">{r.b_61_90 ? formatINR(r.b_61_90, false) : '—'}</td>
                <td className="r num text-warn">{r.b_90_plus ? formatINR(r.b_90_plus, false) : '—'}</td>
                <td className="r num font-medium">{formatINR(r.outstanding, false)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-6 text-center text-muted">Nothing outstanding.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="font-semibold">
              <td colSpan={2}>Total</td>
              <td className="r num">{formatINR(sum('b_0_30'), false)}</td>
              <td className="r num">{formatINR(sum('b_31_60'), false)}</td>
              <td className="r num">{formatINR(sum('b_61_90'), false)}</td>
              <td className="r num">{formatINR(sum('b_90_plus'), false)}</td>
              <td className="r num">{formatINR(sum('outstanding'), false)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </Card>
  )
}

function Gst({ orgId }: { orgId: string | null }) {
  const { data } = useGstSummary(orgId)
  const net = data?.net_payable ?? 0
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><p className="text-xs text-muted">Output tax (collected)</p><p className="num mt-1 text-lg font-semibold">{formatINR(data?.output_tax ?? 0)}</p></Card>
      <Card><p className="text-xs text-muted">Input credit (ITC)</p><p className="num mt-1 text-lg font-semibold">{formatINR(data?.input_credit ?? 0)}</p></Card>
      <Card>
        <p className="text-xs text-muted">{net >= 0 ? 'Net payable' : 'Credit carried forward'}</p>
        <p className={`num mt-1 text-lg font-semibold ${net >= 0 ? 'text-neg' : 'text-pos'}`}>{formatINR(Math.abs(net))}</p>
      </Card>
    </div>
  )
}
