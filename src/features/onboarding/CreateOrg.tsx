import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Input, Field, Select } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function CreateOrg() {
  const { refreshMemberships, setCurrentOrgId, signOut } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [fyMonth, setFyMonth] = useState(4)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [cash, setCash] = useState('')
  const [bank, setBank] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createOrg(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const id = await rpc.createOrganization(name, fyMonth)
      setOrgId(id)
      await refreshMemberships()
      setCurrentOrgId(id)
      setStep(2)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveOpening(skip: boolean) {
    if (!orgId) return
    setBusy(true)
    setError(null)
    try {
      if (!skip && (cash || bank)) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id, system_key')
          .eq('org_id', orgId)
          .in('system_key', ['cash', 'bank'])
        const find = (k: string) => accts?.find((a) => a.system_key === k)?.id
        const entries: { account_id: string; debit: number; credit: number }[] = []
        if (cash) entries.push({ account_id: find('cash')!, debit: rupeesToPaise(cash), credit: 0 })
        if (bank) entries.push({ account_id: find('bank')!, debit: rupeesToPaise(bank), credit: 0 })
        if (entries.length) await rpc.openingBalances(orgId, entries, [])
      }
      // Onboarding complete — App routes to dashboard once membership + org are set.
      window.location.href = '/'
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-4">
      <Card className="w-full max-w-sm">
        {step === 1 ? (
          <>
            <h1 className="text-xl font-semibold">Set up your business</h1>
            <p className="mb-5 text-sm text-muted">This becomes your organisation's books.</p>
            <form onSubmit={createOrg} className="space-y-3">
              <Field label="Business name">
                <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma Traders" />
              </Field>
              <Field label="Financial year starts in" hint="India usually starts in April.">
                <Select value={fyMonth} onChange={(e) => setFyMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </Select>
              </Field>
              {error && <p className="text-sm text-neg">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? 'Creating…' : 'Create books'}
              </Button>
            </form>
            <button onClick={signOut} className="mt-4 w-full text-center text-sm text-muted">Sign out</button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Opening balances</h1>
            <p className="mb-5 text-sm text-muted">How much cash and bank do you start with? (Optional)</p>
            <div className="space-y-3">
              <Field label="Cash in hand (₹)">
                <Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Bank balance (₹)">
                <Input inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="0" />
              </Field>
              {error && <p className="text-sm text-neg">{error}</p>}
              <Button size="lg" className="w-full" disabled={busy} onClick={() => saveOpening(false)}>
                {busy ? 'Saving…' : 'Save & continue'}
              </Button>
              <Button variant="ghost" className="w-full" disabled={busy} onClick={() => saveOpening(true)}>
                Skip for now
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
