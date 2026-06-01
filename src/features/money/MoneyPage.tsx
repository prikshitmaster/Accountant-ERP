import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Input, Field, Select } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

type Action = 'expense' | 'contra' | 'capital' | 'drawings'
const today = () => new Date().toISOString().slice(0, 10)

export function MoneyPage() {
  const { currentOrgId, role } = useAuth()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts(currentOrgId)
  const [action, setAction] = useState<Action>('expense')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const elevated = role === 'owner' || role === 'accountant'
  const expenseAccounts = accounts.filter((a) => a.group_id === 5 && a.system_key !== 'cogs')
  const cash = accounts.find((a) => a.system_key === 'cash')
  const bank = accounts.find((a) => a.system_key === 'bank')

  // form fields
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'cash' | 'bank'>('cash')
  const [expenseAccount, setExpenseAccount] = useState('')
  const [narration, setNarration] = useState('')
  const [contraDir, setContraDir] = useState<'cash_to_bank' | 'bank_to_cash'>('cash_to_bank')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    setBusy(true); setError(null); setMsg(null)
    const paise = rupeesToPaise(amount)
    try {
      let res: { voucher_no?: string } | unknown
      if (action === 'expense') {
        res = await rpc.expense(currentOrgId, date, expenseAccount, paise, mode, narration)
      } else if (action === 'contra') {
        const from = contraDir === 'cash_to_bank' ? cash!.id : bank!.id
        const to = contraDir === 'cash_to_bank' ? bank!.id : cash!.id
        res = await rpc.contra(currentOrgId, date, from, to, paise, narration)
      } else if (action === 'capital') {
        res = await rpc.introduceCapital(currentOrgId, date, paise, mode)
      } else {
        res = await rpc.drawings(currentOrgId, date, paise, mode)
      }
      const vno = (res as { voucher_no?: string })?.voucher_no
      setMsg(vno ? `Saved · ${vno}` : 'Saved')
      setAmount(''); setNarration('')
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['daybook'] })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const tabs: { id: Action; label: string; show: boolean }[] = [
    { id: 'expense', label: 'Expense', show: true },
    { id: 'contra', label: 'Cash ↔ Bank', show: true },
    { id: 'capital', label: 'Capital', show: elevated },
    { id: 'drawings', label: 'Drawings', show: elevated },
  ]

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Money</h2>

      <div className="flex flex-wrap gap-2">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            onClick={() => { setAction(t.id); setMsg(null); setError(null) }}
            className={`rounded-full px-3 py-1.5 text-sm ${action === t.id ? 'bg-brand-600 text-white' : 'bg-white border border-line text-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>

          {action === 'expense' && (
            <Field label="Expense type">
              <Select required value={expenseAccount} onChange={(e) => setExpenseAccount(e.target.value)}>
                <option value="" disabled>Select…</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          )}

          {action === 'contra' && (
            <Field label="Direction">
              <Select value={contraDir} onChange={(e) => setContraDir(e.target.value as typeof contraDir)}>
                <option value="cash_to_bank">Cash → Bank (deposit)</option>
                <option value="bank_to_cash">Bank → Cash (withdraw)</option>
              </Select>
            </Field>
          )}

          <Field label="Amount (₹)">
            <Input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>

          {(action === 'expense' || action === 'capital' || action === 'drawings') && (
            <Field label="Paid via">
              <Select value={mode} onChange={(e) => setMode(e.target.value as 'cash' | 'bank')}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </Select>
            </Field>
          )}

          {action === 'expense' && (
            <Field label="Note (optional)">
              <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
            </Field>
          )}

          {error && <p className="text-sm text-neg">{error}</p>}
          {msg && <p className="text-sm text-pos">{msg}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
