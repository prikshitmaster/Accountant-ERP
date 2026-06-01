import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/components/ui/Card'
import { Field, Select } from '@/components/ui/Input'
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
