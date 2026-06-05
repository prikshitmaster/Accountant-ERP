import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise } from '@/lib/money'
import { GST_STATES } from '@/lib/states'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'

function FormRow({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-6 border-b border-line py-3 last:border-0">
      <div className="w-40 shrink-0 pt-2.5">
        <span className="text-sm text-muted">{label}{required && <span className="ml-0.5 text-neg">*</span>}</span>
      </div>
      <div className="flex-1 min-w-0">
        {children}
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const maskAadhaar = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 12)
  return d.length <= 4 ? d : 'XXXX XXXX ' + d.slice(-4)
}

type Props = {
  open: boolean
  onClose: () => void
  defaultKind?: 'customer' | 'supplier' | 'both'
}

export function PartyFormDrawer({ open, onClose, defaultKind = 'customer' }: Props) {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()

  const [tab, setTab] = useState<'primary' | 'address' | 'other'>('primary')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'customer' | 'supplier' | 'both'>(defaultKind)
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('')
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

  const onGstin = (v: string) => {
    setGstin(v.toUpperCase())
    if (v.length >= 2 && /^\d{2}$/.test(v.slice(0, 2))) setStateCode(v.slice(0, 2))
  }

  function reset() {
    setName(''); setPhone(''); setGstin(''); setStateCode(''); setKind(defaultKind)
    setAlias(''); setGroup(''); setArea(''); setCity(''); setPincode(''); setBilling('')
    setSameShip(true); setShipping(''); setEmail(''); setContact(''); setPan(''); setAadhaar('')
    setUdyam(''); setActivity(''); setCreditLimit(''); setCreditDays('')
    setOpenAmt(''); setOpenType('dr'); setOpenDate(today()); setTab('primary'); setError(null)
  }

  function close() { reset(); onClose() }

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
      qc.invalidateQueries({ queryKey: ['parties'] })
      qc.invalidateQueries({ queryKey: ['trial_balance'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      close()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={close} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold">New Party</h2>
          <button onClick={close} className="text-muted hover:text-ink"><X size={20} /></button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-line bg-canvas px-5">
          {(['primary', 'address', 'other'] as const).map((t) => {
            const labels = { primary: 'Primary', address: 'Address', other: 'Other Details' }
            return (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted hover:text-ink'
                }`}>
                {labels[t]}
              </button>
            )
          })}
        </div>

        {/* Form body */}
        <form onSubmit={submit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-2">

            {tab === 'primary' && (
              <>
                <FormRow label="Party Type" required>
                  <div className="flex gap-4 pt-2">
                    {(['customer', 'supplier', 'both'] as const).map((k) => (
                      <label key={k} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-brand-600" />
                        {k === 'both' ? 'Both' : k === 'customer' ? 'Customer' : 'Supplier'}
                      </label>
                    ))}
                  </div>
                </FormRow>
                <FormRow label="Name" required>
                  <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Business / person name" />
                </FormRow>
                <FormRow label="Mobile">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+91 98100 00000" />
                </FormRow>
                <FormRow label="Email">
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="email@example.com" />
                </FormRow>
                <FormRow label="GSTIN" hint="State code auto-filled from first 2 digits.">
                  <Input value={gstin} maxLength={15} onChange={(e) => onGstin(e.target.value)} placeholder="07AABCT1234E1Z5" />
                </FormRow>
                <FormRow label="State (supply)">
                  <Select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                    <option value="">— Select state —</option>
                    {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
                  </Select>
                </FormRow>
              </>
            )}

            {tab === 'address' && (
              <>
                <FormRow label="Area"><Input value={area} onChange={(e) => setArea(e.target.value)} /></FormRow>
                <FormRow label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} /></FormRow>
                <FormRow label="Pincode"><Input value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric" className="max-w-[160px]" /></FormRow>
                <FormRow label="Billing Address">
                  <Input value={billing} onChange={(e) => setBilling(e.target.value)} placeholder="Street, locality…" />
                </FormRow>
                <FormRow label="Shipping Address">
                  <label className="flex items-center gap-2 text-sm text-muted mb-2 cursor-pointer">
                    <input type="checkbox" checked={sameShip} onChange={(e) => setSameShip(e.target.checked)} className="accent-brand-600" />
                    Same as billing
                  </label>
                  {!sameShip && <Input value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="Street, locality…" />}
                </FormRow>
              </>
            )}

            {tab === 'other' && (
              <>
                <FormRow label="Alias"><Input value={alias} onChange={(e) => setAlias(e.target.value)} /></FormRow>
                <FormRow label="Group"><Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Wholesale" /></FormRow>
                <FormRow label="Contact Person"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></FormRow>
                <FormRow label="PAN"><Input value={pan} maxLength={10} onChange={(e) => setPan(e.target.value.toUpperCase())} className="max-w-[200px]" /></FormRow>
                <FormRow label="Aadhaar" hint="Only last 4 digits stored.">
                  <Input value={maskAadhaar(aadhaar)} inputMode="numeric" onChange={(e) => setAadhaar(e.target.value)} placeholder="XXXX XXXX 1234" className="max-w-[240px]" />
                </FormRow>
                <FormRow label="Udyam No."><Input value={udyam} onChange={(e) => setUdyam(e.target.value)} className="max-w-[240px]" /></FormRow>
                <FormRow label="MSME Activity">
                  <Select value={activity} onChange={(e) => setActivity(e.target.value)} className="max-w-[200px]">
                    <option value="">—</option>
                    <option>Manufacturer</option><option>Trader</option><option>Service</option>
                  </Select>
                </FormRow>
                <FormRow label="Credit Limit (₹)">
                  <Input value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} inputMode="decimal" className="max-w-[200px]" />
                </FormRow>
                <FormRow label="Credit Days">
                  <Input value={creditDays} onChange={(e) => setCreditDays(e.target.value)} inputMode="numeric" className="max-w-[120px]" />
                </FormRow>
                <FormRow label="Opening Balance (₹)">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} inputMode="decimal" className="max-w-[150px]" />
                    <Select value={openType} onChange={(e) => setOpenType(e.target.value as 'dr' | 'cr')} className="max-w-[160px]">
                      <option value="dr">Dr — they owe us</option>
                      <option value="cr">Cr — we owe them</option>
                    </Select>
                    <Input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} className="max-w-[150px]" />
                  </div>
                </FormRow>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-line bg-canvas px-6 py-3">
            {error ? <p className="text-sm text-neg">{error}</p> : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        </form>
      </div>
    </>
  )
}
