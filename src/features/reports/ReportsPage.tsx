import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useDayBook } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'

type TBRow = {
  account_id: string
  account_name: string
  closing_debit: number
  closing_credit: number
}

function useTrialBalance(orgId: string | null) {
  return useQuery({
    queryKey: ['trial_balance', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<TBRow[]> => {
      const { data, error } = await supabase
        .from('v_trial_balance')
        .select('account_id, account_name, closing_debit, closing_credit')
        .eq('org_id', orgId)
        .order('account_name')
      if (error) throw error
      return (data ?? []) as TBRow[]
    },
  })
}

export function ReportsPage() {
  const { currentOrgId } = useAuth()
  const [tab, setTab] = useState<'tb' | 'daybook'>('tb')
  const { data: tb = [] } = useTrialBalance(currentOrgId)
  const { data: rows = [] } = useDayBook(currentOrgId, 100)

  const totalDr = tb.reduce((s, r) => s + r.closing_debit, 0)
  const totalCr = tb.reduce((s, r) => s + r.closing_credit, 0)
  const balanced = totalDr === totalCr

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Reports</h2>
      <div className="flex gap-2">
        {([['tb', 'Trial Balance'], ['daybook', 'Day Book']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-1.5 text-sm ${tab === id ? 'bg-brand-600 text-white' : 'bg-white border border-line text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tb' ? (
        <Card className="p-0">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-xs font-medium text-muted">
            <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span>
          </div>
          <ul className="divide-y divide-line">
            {tb.map((r) => (
              <li key={r.account_id} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2.5 text-sm">
                <span className="truncate">{r.account_name}</span>
                <span className="text-right tabular-nums">{r.closing_debit ? formatINR(r.closing_debit, false) : '—'}</span>
                <span className="text-right tabular-nums">{r.closing_credit ? formatINR(r.closing_credit, false) : '—'}</span>
              </li>
            ))}
            {tb.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No entries yet.</li>}
          </ul>
          {tb.length > 0 && (
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-t border-line px-4 py-2.5 text-sm font-semibold">
              <span className={balanced ? 'text-pos' : 'text-neg'}>{balanced ? 'Balanced' : 'NOT balanced'}</span>
              <span className="text-right tabular-nums">{formatINR(totalDr, false)}</span>
              <span className="text-right tabular-nums">{formatINR(totalCr, false)}</span>
            </div>
          )}
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.voucher_id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.type_name}{r.party_name ? ` · ${r.party_name}` : ''}</p>
                  <p className="text-xs text-muted">{formatDate(r.date)} · {r.voucher_no}{r.status === 'cancelled' ? ' · cancelled' : ''}</p>
                </div>
                <span className={`text-sm font-semibold ${r.status === 'cancelled' ? 'text-muted line-through' : ''}`}>{formatINR(r.amount)}</span>
              </li>
            ))}
            {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No transactions yet.</li>}
          </ul>
        </Card>
      )}
    </div>
  )
}
