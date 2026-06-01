import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { rpc } from '@/lib/rpc'
import { Card } from '@/components/ui/Card'
import { Field, Select, Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

type Policy = 'block' | 'warn' | 'allow'

export function SettingsPage() {
  const { currentOrgId, role } = useAuth()
  const [policy, setPolicy] = useState<Policy>('warn')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const elevated = role === 'owner' || role === 'accountant'

  useEffect(() => {
    if (!currentOrgId) return
    supabase
      .from('org_settings')
      .select('negative_stock_policy')
      .eq('org_id', currentOrgId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.negative_stock_policy) setPolicy(data.negative_stock_policy as Policy)
      })
  }, [currentOrgId])

  async function save() {
    if (!currentOrgId) return
    setBusy(true); setMsg(null)
    const { error } = await supabase
      .from('org_settings')
      .update({ negative_stock_policy: policy, updated_at: new Date().toISOString() })
      .eq('org_id', currentOrgId)
    setMsg(error ? error.message : 'Saved')
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Settings</h2>
      {elevated && <PeriodLock />}
      <Card className="space-y-3">
        <Field label="Negative stock" hint="What happens when stock would go below zero.">
          <Select value={policy} onChange={(e) => setPolicy(e.target.value as Policy)} disabled={!elevated}>
            <option value="block">Block — prevent the entry</option>
            <option value="warn">Warn — allow but flag</option>
            <option value="allow">Allow — no restriction</option>
          </Select>
        </Field>
        {msg && <p className="text-sm text-pos">{msg}</p>}
        {elevated && (
          <Button onClick={save} disabled={busy} className="w-full">
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        )}
      </Card>
    </div>
  )
}

function PeriodLock() {
  const { currentOrgId } = useAuth()
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function lock() {
    if (!currentOrgId || !date) return
    setBusy(true); setMsg(null); setError(null)
    try {
      await rpc.closePeriod(currentOrgId, date)
      setMsg(`Books locked up to ${date}. Earlier dates can no longer be posted.`)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card className="space-y-3">
      <div>
        <p className="font-medium">Lock period</p>
        <p className="text-xs text-muted">Prevent posting or editing on/before a date. Use after filing returns.</p>
      </div>
      <Field label="Lock everything up to">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-neg">{error}</p>}
      {msg && <p className="text-sm text-pos">{msg}</p>}
      <Button variant="secondary" onClick={lock} disabled={busy || !date} className="w-full">
        {busy ? 'Locking…' : 'Lock period'}
      </Button>
    </Card>
  )
}
