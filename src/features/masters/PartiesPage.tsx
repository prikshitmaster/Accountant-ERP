import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useParties } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR } from '@/lib/money'
import { GST_STATES, stateName } from '@/lib/states'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'

export function PartiesPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const { data: parties = [] } = useParties(currentOrgId)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'customer' | 'supplier' | 'both'>('customer')
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onGstin = (v: string) => {
    setGstin(v.toUpperCase())
    if (v.length >= 2 && /^\d{2}$/.test(v.slice(0, 2))) setStateCode(v.slice(0, 2))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    setBusy(true); setError(null)
    try {
      await rpc.createParty(currentOrgId, name, kind, phone || undefined, gstin || undefined, stateCode || undefined)
      setOpen(false); setName(''); setPhone(''); setGstin(''); setStateCode(''); setKind('customer')
      qc.invalidateQueries({ queryKey: ['parties'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Parties</h2>
        <Button onClick={() => setOpen((o) => !o)} variant={open ? 'secondary' : 'primary'}>
          {open ? 'Close' : '+ New party'}
        </Button>
      </div>

      {open && (
        <Card>
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Type">
              <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="customer">Customer</option>
                <option value="supplier">Supplier</option>
                <option value="both">Both</option>
              </Select>
            </Field>
            <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
            <Field label="GSTIN" hint="State is auto-set from the first 2 digits.">
              <Input value={gstin} maxLength={15} onChange={(e) => onGstin(e.target.value)} placeholder="07AABCT1234E1Z5" />
            </Field>
            <Field label="State (place of supply)">
              <Select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                <option value="">—</option>
                {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
              </Select>
            </Field>
            <div className="flex items-end">
              {error && <p className="text-sm text-neg">{error}</p>}
              <Button type="submit" className="ml-auto" disabled={busy}>{busy ? 'Saving…' : 'Save party'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Type</th><th>State</th><th>Phone</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => nav(`/reports?ledger=${p.id}`)}>
                  <td className="font-medium">{p.name}</td>
                  <td className="capitalize text-muted">{p.kind}</td>
                  <td className="text-muted">{stateName((p as { state_code?: string }).state_code)}</td>
                  <td className="num text-muted">{p.phone ?? '—'}</td>
                  <td className={`r num ${p.balance > 0 ? 'text-pos' : p.balance < 0 ? 'text-neg' : ''}`}>{formatINR(Math.abs(p.balance))}</td>
                </tr>
              ))}
              {!parties.length && <tr><td colSpan={5} className="py-6 text-center text-muted">No parties yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
