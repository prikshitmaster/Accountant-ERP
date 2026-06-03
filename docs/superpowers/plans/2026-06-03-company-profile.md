# Company Profile + Bank Details — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add company identity + bank details to org_settings; surface them in Settings UI and on the printed Tax Invoice.

**Architecture:** Single migration adds 11 columns to `org_settings` and refreshes `v_invoice_detail`. A new `useOrgSettings` hook and 11 new fields on `InvoiceDetail` make all data available. `SettingsPage` gets two new editable cards. `InvoicePrint` shows the full company header and a bank/UPI payment footer.

**Tech Stack:** Supabase Postgres, React + TypeScript, Tailwind v4, TanStack Query.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/0014_company_profile.sql` | Alter org_settings + refresh v_invoice_detail |
| Modify | `src/hooks/queries.ts` | Add OrgSettings type + useOrgSettings hook + 11 new InvoiceDetail fields |
| Modify | `src/features/settings/SettingsPage.tsx` | Company Profile + Bank Details cards |
| Modify | `src/features/sales/InvoicePrint.tsx` | Enriched header + payment footer |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/0014_company_profile.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================
-- Company profile: add contact, address, bank details to org_settings.
-- Refresh v_invoice_detail to carry all org fields.
-- =============================================================

alter table org_settings
  add column if not exists phone           text,
  add column if not exists email           text,
  add column if not exists address_line1   text,
  add column if not exists address_line2   text,
  add column if not exists city            text,
  add column if not exists pincode         text,
  add column if not exists pan_no          text,
  add column if not exists bank_name       text,
  add column if not exists bank_account_no text,
  add column if not exists bank_ifsc       text,
  add column if not exists upi             text;

-- Refresh view (drop required because column order changes)
drop view if exists v_invoice_detail;
create view v_invoice_detail with (security_invoker = on) as
select
  i.org_id,
  i.id              as invoice_id,
  i.invoice_no,
  i.date,
  i.total,
  i.outstanding,
  i.discount_amount,
  i.freight_amount,
  i.round_off,
  i.party_id,
  p.name            as party_name,
  p.gstin           as party_gstin,
  p.state_code      as party_state_code,
  v.narration,
  il.id             as line_id,
  il.stock_item_id,
  si.name           as item_name,
  si.unit,
  si.hsn,
  si.gst_rate,
  il.qty,
  il.rate,
  il.amount,
  o.name            as org_name,
  os.gstin          as org_gstin,
  os.state_code     as org_state_code,
  os.pan_no         as org_pan_no,
  os.phone          as org_phone,
  os.email          as org_email,
  os.address_line1  as org_address_line1,
  os.address_line2  as org_address_line2,
  os.city           as org_city,
  os.pincode        as org_pincode,
  os.bank_name      as org_bank_name,
  os.bank_account_no as org_bank_account_no,
  os.bank_ifsc      as org_bank_ifsc,
  os.upi            as org_upi
from invoices i
join  parties       p  on p.id      = i.party_id
join  vouchers      v  on v.id      = i.voucher_id
join  invoice_lines il on il.invoice_id = i.id
join  stock_items   si on si.id     = il.stock_item_id
join  organizations o  on o.id      = i.org_id
left join org_settings os on os.org_id = i.org_id;

grant select on v_invoice_detail to authenticated;
```

- [ ] **Step 2: Apply**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | sed 's/^DATABASE_URL=//')"
node scripts/run-migrations.mjs 0014
```

Expected: `Applying 0014_company_profile.sql … ok`

- [ ] **Step 3: Verify**

```bash
node -e "
import('pg').then(({default:pg})=>{
  const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  c.connect()
    .then(()=>c.query(\"select column_name from information_schema.columns where table_name='org_settings' and column_name in ('phone','email','city','bank_ifsc','upi')\"))
    .then(r=>{console.log(r.rows.map(x=>x.column_name));c.end()});
})
"
```

Expected: 5 column names.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0014_company_profile.sql
git commit -m "feat(db): add company profile + bank details to org_settings + v_invoice_detail"
```

---

## Task 2: useOrgSettings hook + InvoiceDetail fields

**Files:**
- Modify: `src/hooks/queries.ts`

- [ ] **Step 1: Add `OrgSettings` type and `useOrgSettings` hook**

Append to end of `src/hooks/queries.ts`:

```ts
export type OrgSettings = {
  org_id: string
  business_name: string | null
  gstin: string | null
  state_code: string | null
  pan_no: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  pincode: string | null
  bank_name: string | null
  bank_account_no: string | null
  bank_ifsc: string | null
  upi: string | null
  negative_stock_policy: string
}

export function useOrgSettings(orgId: string | null) {
  return useQuery({
    queryKey: ['org_settings', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<OrgSettings | null> => {
      const { data, error } = await supabase
        .from('org_settings')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) throw error
      return data as OrgSettings | null
    },
  })
}
```

- [ ] **Step 2: Add 11 new fields to `InvoiceDetail` type**

In the `InvoiceDetail` type, add after `org_state_code: string | null`:

```ts
org_pan_no: string | null
org_phone: string | null
org_email: string | null
org_address_line1: string | null
org_address_line2: string | null
org_city: string | null
org_pincode: string | null
org_bank_name: string | null
org_bank_account_no: string | null
org_bank_ifsc: string | null
org_upi: string | null
```

- [ ] **Step 3: Map new fields in `useInvoiceDetail` queryFn**

After `org_state_code: first.org_state_code ? String(first.org_state_code) : null,` add:

```ts
org_pan_no:         first.org_pan_no         ? String(first.org_pan_no)         : null,
org_phone:          first.org_phone          ? String(first.org_phone)          : null,
org_email:          first.org_email          ? String(first.org_email)          : null,
org_address_line1:  first.org_address_line1  ? String(first.org_address_line1)  : null,
org_address_line2:  first.org_address_line2  ? String(first.org_address_line2)  : null,
org_city:           first.org_city           ? String(first.org_city)           : null,
org_pincode:        first.org_pincode        ? String(first.org_pincode)        : null,
org_bank_name:      first.org_bank_name      ? String(first.org_bank_name)      : null,
org_bank_account_no: first.org_bank_account_no ? String(first.org_bank_account_no) : null,
org_bank_ifsc:      first.org_bank_ifsc      ? String(first.org_bank_ifsc)      : null,
org_upi:            first.org_upi            ? String(first.org_upi)            : null,
```

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/queries.ts
git commit -m "feat(fe): useOrgSettings hook + 11 org profile fields on InvoiceDetail"
```

---

## Task 3: SettingsPage — Company Profile + Bank Details

**Files:**
- Modify: `src/features/settings/SettingsPage.tsx`

- [ ] **Step 1: Read the current file, then replace entirely**

Replace `src/features/settings/SettingsPage.tsx` with:

```tsx
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
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/SettingsPage.tsx
git commit -m "feat(fe): Company Profile + Bank Details sections in Settings"
```

---

## Task 4: Enrich InvoicePrint with address + bank footer

**Files:**
- Modify: `src/features/sales/InvoicePrint.tsx`

- [ ] **Step 1: Read the file, then update the supplier block and add payment footer**

**In the Supplier + Invoice meta section** (the `<div className="flex justify-between mb-6">`), replace the left supplier div with:

```tsx
<div>
  <p className="font-semibold text-base">{inv.org_name}</p>
  {inv.org_gstin && <p className="text-xs mt-0.5">GSTIN: {inv.org_gstin}</p>}
  {(inv.org_state_code || inv.org_pan_no) && (
    <p className="text-xs">
      {inv.org_state_code && `State: ${inv.org_state_code}`}
      {inv.org_state_code && inv.org_pan_no && '  |  '}
      {inv.org_pan_no && `PAN: ${inv.org_pan_no}`}
    </p>
  )}
  {inv.org_address_line1 && <p className="text-xs mt-0.5">{inv.org_address_line1}</p>}
  {inv.org_address_line2 && <p className="text-xs">{inv.org_address_line2}</p>}
  {(inv.org_city || inv.org_pincode) && (
    <p className="text-xs">{[inv.org_city, inv.org_pincode].filter(Boolean).join(' - ')}</p>
  )}
  {inv.org_phone && <p className="text-xs mt-0.5">Ph: {inv.org_phone}</p>}
  {inv.org_email && <p className="text-xs">E: {inv.org_email}</p>}
</div>
```

**Add a Payment Details section** between the narration and the footer div:

```tsx
{(inv.org_bank_name || inv.org_upi) && (
  <div className="border border-black p-3 mb-4 text-xs">
    <p className="font-semibold mb-1">Payment Details</p>
    {inv.org_bank_name && (
      <p>
        Bank: {inv.org_bank_name}
        {inv.org_bank_account_no && ` | A/c: ${inv.org_bank_account_no}`}
        {inv.org_bank_ifsc && ` | IFSC: ${inv.org_bank_ifsc}`}
      </p>
    )}
    {inv.org_upi && <p className="mt-0.5">UPI: {inv.org_upi}</p>}
  </div>
)}
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Step 3: Commit**

```bash
git add src/features/sales/InvoicePrint.tsx
git commit -m "feat(fe): show org address + bank/UPI on printed Tax Invoice"
```
