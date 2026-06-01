import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useParties } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR, rupeesToPaise } from '@/lib/money'
import { GST_STATES, stateName } from '@/lib/states'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'

const today = () => new Date().toISOString().slice(0, 10)
const maskAadhaar = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 12)
  return d.length <= 4 ? d : 'XXXX XXXX ' + d.slice(-4)
}

export function PartiesPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const { data: parties = [] } = useParties(currentOrgId)

  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [groupFilter, setGroupFilter] = useState('')

  const [name, setName] = useState('')
  const [kind, setKind] = useState<'customer' | 'supplier' | 'both'>('customer')
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('')
  // more
  const [alias, setAlias] = useState('')
  const [group, setGroup] = useState('')
  const [area, setArea] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [billing, setBilling] = useState('')
  const [sameShip, setSameShip] = useState(true)
  const [shipping, setShipping] = useState('')
  const [email, setEmail] = useState('')
  const [contact, setContact] = useState('')
  const [pan, setPan] = useState('')
  const [aadhaar, setAadhaar] = useState('')
  const [udyam, setUdyam] = useState('')
  const [activity, setActivity] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [creditDays, setCreditDays] = useState('')
  const [openAmt, setOpenAmt] = useState('')
  const [openType, setOpenType] = useState<'dr' | 'cr'>('dr')
  const [openDate, setOpenDate] = useState(today())

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(
    () => Array.from(new Set(parties.map((p) => p.group_name).filter(Boolean))) as string[],
    [parties],
  )
  const shown = groupFilter ? parties.filter((p) => p.group_name === groupFilter) : parties
  const groupTotal = shown.reduce((s, p) => s + Math.abs(p.balance), 0)

  const onGstin = (v: string) => {
    setGstin(v.toUpperCase())
    if (v.length >= 2 && /^\d{2}$/.test(v.slice(0, 2))) setStateCode(v.slice(0, 2))
  }

  function resetForm() {
    setName(''); setPhone(''); setGstin(''); setStateCode(''); setKind('customer')
    setAlias(''); setGroup(''); setArea(''); setCity(''); setPincode(''); setBilling('')
    setSameShip(true); setShipping(''); setEmail(''); setContact(''); setPan(''); setAadhaar('')
    setUdyam(''); setActivity(''); setCreditLimit(''); setCreditDays('')
    setOpenAmt(''); setOpenType('dr'); setOpenDate(today()); setMore(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    setBusy(true); setError(null)
    const details: Record<string, unknown> = {
      alias: alias || null, group_name: group || null, area: area || null, city: city || null,
      pincode: pincode || null, billing_address: billing || null,
      shipping_address: sameShip ? null : (shipping || null),
      email: email || null, contact_person: contact || null, pan: pan || null,
      aadhaar: aadhaar.replace(/\D/g, '') || null, udyam_no: udyam || null,
      msme_activity: activity || null,
      credit_limit: creditLimit ? rupeesToPaise(creditLimit) : 0,
      credit_days: creditDays ? Number(creditDays) : 0,
    }
    const opening = openAmt && Number(openAmt) > 0
      ? { amount: rupeesToPaise(openAmt), type: openType, date: openDate }
      : undefined
    try {
      await rpc.createParty(currentOrgId, name, kind, phone || undefined, gstin || undefined, stateCode || undefined, details, opening)
      setOpen(false); resetForm()
      qc.invalidateQueries({ queryKey: ['parties'] })
      qc.invalidateQueries({ queryKey: ['trial_balance'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
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
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Type">
                <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="customer">Customer</option>
                  <option value="supplier">Supplier</option>
                  <option value="both">Both</option>
                </Select>
              </Field>
              <Field label="Mobile"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
              <Field label="GSTIN" hint="State is auto-set from the first 2 digits.">
                <Input value={gstin} maxLength={15} onChange={(e) => onGstin(e.target.value)} placeholder="07AABCT1234E1Z5" />
              </Field>
              <Field label="State (place of supply)">
                <Select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                  <option value="">—</option>
                  {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
                </Select>
              </Field>
            </div>

            <button type="button" onClick={() => setMore((m) => !m)}
              className="flex items-center gap-1 text-sm font-medium text-brand-600">
              {more ? <ChevronDown size={16} /> : <ChevronRight size={16} />} More details
            </button>

            {more && (
              <div className="grid gap-3 rounded-xl border border-line bg-surface p-3 md:grid-cols-2">
                <Field label="Alias"><Input value={alias} onChange={(e) => setAlias(e.target.value)} /></Field>
                <Field label="Group"><Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Wholesale" /></Field>
                <Field label="Area"><Input value={area} onChange={(e) => setArea(e.target.value)} /></Field>
                <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
                <Field label="Pincode"><Input value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric" /></Field>
                <Field label="Billing address"><Input value={billing} onChange={(e) => setBilling(e.target.value)} /></Field>
                <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" /></Field>
                <Field label="Contact person"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
                <Field label="PAN"><Input value={pan} maxLength={10} onChange={(e) => setPan(e.target.value.toUpperCase())} /></Field>
                <Field label="Aadhaar" hint="Masked; optional.">
                  <Input value={maskAadhaar(aadhaar)} inputMode="numeric"
                    onChange={(e) => setAadhaar(e.target.value)} placeholder="XXXX XXXX 1234" />
                </Field>
                <Field label="Udyam No."><Input value={udyam} onChange={(e) => setUdyam(e.target.value)} /></Field>
                <Field label="MSME activity">
                  <Select value={activity} onChange={(e) => setActivity(e.target.value)}>
                    <option value="">—</option>
                    <option>Manufacturer</option><option>Trader</option><option>Service</option>
                  </Select>
                </Field>
                <Field label="Credit limit (₹)"><Input value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} inputMode="decimal" /></Field>
                <Field label="Credit days"><Input value={creditDays} onChange={(e) => setCreditDays(e.target.value)} inputMode="numeric" /></Field>
                <div className="md:col-span-2 grid grid-cols-3 gap-2">
                  <Field label="Opening balance (₹)"><Input value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} inputMode="decimal" /></Field>
                  <Field label="Dr/Cr">
                    <Select value={openType} onChange={(e) => setOpenType(e.target.value as 'dr' | 'cr')}>
                      <option value="dr">Dr (they owe)</option>
                      <option value="cr">Cr (we owe)</option>
                    </Select>
                  </Field>
                  <Field label="As on"><Input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} /></Field>
                </div>
                {!sameShip && (
                  <Field label="Shipping address"><Input value={shipping} onChange={(e) => setShipping(e.target.value)} /></Field>
                )}
                <label className="flex items-center gap-2 text-sm text-muted md:col-span-2">
                  <input type="checkbox" checked={sameShip} onChange={(e) => setSameShip(e.target.checked)} />
                  Shipping same as billing
                </label>
              </div>
            )}

            <div className="flex items-center">
              {error && <p className="text-sm text-neg">{error}</p>}
              <Button type="submit" className="ml-auto" disabled={busy}>{busy ? 'Saving…' : 'Save party'}</Button>
            </div>
          </form>
        </Card>
      )}

      {groups.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Group:</span>
          <Select className="max-w-xs" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">All</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
          {groupFilter && <span className="text-sm text-muted">Total: <span className="num">{formatINR(groupTotal)}</span></span>}
        </div>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Group</th><th>Type</th><th>City</th><th>State</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => nav(`/reports?ledger=${p.id}`)}>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-muted">{p.group_name ?? '—'}</td>
                  <td className="capitalize text-muted">{p.kind}</td>
                  <td className="text-muted">{p.city ?? '—'}</td>
                  <td className="text-muted">{stateName(p.state_code ?? undefined)}</td>
                  <td className={`r num ${p.balance > 0 ? 'text-pos' : p.balance < 0 ? 'text-neg' : ''}`}>{formatINR(Math.abs(p.balance))}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={6} className="py-6 text-center text-muted">No parties yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
