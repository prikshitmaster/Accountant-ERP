import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useOrgSettings } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'

type Policy = 'block' | 'warn' | 'allow'

export function SettingsPage() {
  const { currentOrgId, role } = useAuth()
  const qc = useQueryClient()
  const elevated = role === 'owner' || role === 'accountant'
  const { data: settings } = useOrgSettings(currentOrgId)

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Manage your company profile, preferences, and accounting controls." />
      {elevated && <CompanyProfile orgId={currentOrgId} settings={settings ?? null} onSaved={() => qc.invalidateQueries({ queryKey: ['org_settings', currentOrgId] })} />}
      {elevated && <BankDetails orgId={currentOrgId} settings={settings ?? null} onSaved={() => qc.invalidateQueries({ queryKey: ['org_settings', currentOrgId] })} />}
      {elevated && <PeriodLock />}
      <NegativeStock orgId={currentOrgId} elevated={elevated} policy={(settings?.negative_stock_policy ?? 'warn') as Policy} onSaved={() => qc.invalidateQueries({ queryKey: ['org_settings', currentOrgId] })} />
    </div>
  )
}

function CompanyProfile({ orgId, settings, onSaved }: { orgId: string | null; settings: import('@/hooks/queries').OrgSettings | null; onSaved: () => void }) {
  const [form, setForm] = useState({ business_name: '', gstin: '', state_code: '', pan_no: '', phone: '', email: '', address_line1: '', address_line2: '', city: '', pincode: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (settings) setForm({
      business_name: settings.business_name ?? '',
      gstin:         settings.gstin ?? '',
      state_code:    settings.state_code ?? '',
      pan_no:        settings.pan_no ?? '',
      phone:         settings.phone ?? '',
      email:         settings.email ?? '',
      address_line1: settings.address_line1 ?? '',
      address_line2: settings.address_line2 ?? '',
      city:          settings.city ?? '',
      pincode:       settings.pincode ?? '',
    })
  }, [settings])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save() {
    if (!orgId) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('org_settings').update({ ...form, updated_at: new Date().toISOString() }).eq('org_id', orgId)
    setMsg(error ? error.message : 'Saved')
    if (!error) onSaved()
    setBusy(false)
  }

  return (
    <Card className="space-y-3">
      <p className="font-semibold">Company Profile</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business Name"><Input value={form.business_name} onChange={set('business_name')} /></Field>
        <Field label="GSTIN" hint="15-character GST number"><Input value={form.gstin} onChange={set('gstin')} maxLength={15} placeholder="22AAAAA0000A1Z5" /></Field>
        <Field label="State Code" hint="2-digit GST state code"><Input value={form.state_code} onChange={set('state_code')} maxLength={2} placeholder="24" /></Field>
        <Field label="PAN No"><Input value={form.pan_no} onChange={set('pan_no')} maxLength={10} placeholder="AAAAA0000A" /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="+91 98765 43210" /></Field>
        <Field label="Email"><Input value={form.email} onChange={set('email')} inputMode="email" placeholder="info@company.com" /></Field>
        <Field label="Address Line 1"><Input value={form.address_line1} onChange={set('address_line1')} /></Field>
        <Field label="Address Line 2 (optional)"><Input value={form.address_line2} onChange={set('address_line2')} /></Field>
        <Field label="City"><Input value={form.city} onChange={set('city')} /></Field>
        <Field label="Pincode"><Input value={form.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} /></Field>
      </div>
      {msg && <p className="text-sm text-pos">{msg}</p>}
      <Button onClick={save} disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save company profile'}</Button>
    </Card>
  )
}

function BankDetails({ orgId, settings, onSaved }: { orgId: string | null; settings: import('@/hooks/queries').OrgSettings | null; onSaved: () => void }) {
  const [form, setForm] = useState({ bank_name: '', bank_account_no: '', bank_ifsc: '', upi: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (settings) setForm({
      bank_name:       settings.bank_name ?? '',
      bank_account_no: settings.bank_account_no ?? '',
      bank_ifsc:       settings.bank_ifsc ?? '',
      upi:             settings.upi ?? '',
    })
  }, [settings])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save() {
    if (!orgId) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('org_settings').update({ ...form, updated_at: new Date().toISOString() }).eq('org_id', orgId)
    setMsg(error ? error.message : 'Saved')
    if (!error) onSaved()
    setBusy(false)
  }

  return (
    <Card className="space-y-3">
      <p className="font-semibold">Bank Details</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bank Name"><Input value={form.bank_name} onChange={set('bank_name')} placeholder="State Bank of India" /></Field>
        <Field label="Account No"><Input value={form.bank_account_no} onChange={set('bank_account_no')} inputMode="numeric" /></Field>
        <Field label="IFSC Code"><Input value={form.bank_ifsc} onChange={set('bank_ifsc')} placeholder="SBIN0001234" /></Field>
        <Field label="UPI ID"><Input value={form.upi} onChange={set('upi')} placeholder="business@upi" /></Field>
      </div>
      {msg && <p className="text-sm text-pos">{msg}</p>}
      <Button onClick={save} disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save bank details'}</Button>
    </Card>
  )
}

function NegativeStock({ orgId, elevated, policy: initialPolicy, onSaved }: { orgId: string | null; elevated: boolean; policy: Policy; onSaved: () => void }) {
  const [policy, setPolicy] = useState<Policy>(initialPolicy)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { setPolicy(initialPolicy) }, [initialPolicy])

  async function save() {
    if (!orgId) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('org_settings').update({ negative_stock_policy: policy, updated_at: new Date().toISOString() }).eq('org_id', orgId)
    setMsg(error ? error.message : 'Saved')
    if (!error) onSaved()
    setBusy(false)
  }

  return (
    <Card className="space-y-3">
      <Field label="Negative stock" hint="What happens when stock would go below zero.">
        <Select value={policy} onChange={(e) => setPolicy(e.target.value as Policy)} disabled={!elevated}>
          <option value="block">Block — prevent the entry</option>
          <option value="warn">Warn — allow but flag</option>
          <option value="allow">Allow — no restriction</option>
        </Select>
      </Field>
      {msg && <p className="text-sm text-pos">{msg}</p>}
      {elevated && <Button onClick={save} disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save settings'}</Button>}
    </Card>
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
      <Button variant="secondary" onClick={lock} disabled={busy || !date} className="w-full">{busy ? 'Locking…' : 'Lock period'}</Button>
    </Card>
  )
}
