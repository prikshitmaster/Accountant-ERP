import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useParties, useItems, useInvoices, useCreditNotes } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { ItemTable, emptyLine, type Line } from '@/components/ItemTable'
import { PageHeader } from '@/components/ui/PageHeader'

const today = () => new Date().toISOString().slice(0, 10)

export function SalesPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: customers = [] } = useParties(currentOrgId, 'customer')
  const { data: items = [] } = useItems(currentOrgId)
  const { data: invoices = [] } = useInvoices(currentOrgId)
  const partyName = (id: string) => customers.find((p) => p.id === id)?.name ?? '—'

  const [date, setDate] = useState(today())
  const [mode, setMode] = useState<'credit' | 'cash' | 'bank'>('credit')
  const [party, setParty] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [narration, setNarration] = useState('')
  const [discount, setDiscount] = useState('')
  const [freight, setFreight]   = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [listTab, setListTab] = useState<'invoices' | 'credit_notes'>('invoices')
  const { data: creditNotes = [] } = useCreditNotes(currentOrgId)
  const [cnDate, setCnDate] = useState(today())
  const [cnParty, setCnParty] = useState('')
  const [cnLines, setCnLines] = useState<Line[]>([emptyLine()])
  const [cnNarration, setCnNarration] = useState('')
  const [cnBusy, setCnBusy] = useState(false)
  const [cnMsg, setCnMsg] = useState<string | null>(null)
  const [cnError, setCnError] = useState<string | null>(null)

  const selectedParty = customers.find((p) => p.id === party)
  const linesTotalPaise = lines.reduce(
    (s, l) => s + Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0')),
    0,
  )
  const overLimit =
    mode === 'credit' &&
    selectedParty &&
    selectedParty.credit_limit > 0 &&
    selectedParty.balance + linesTotalPaise > selectedParty.credit_limit

  const discountPaise = rupeesToPaise(discount || '0')
  const freightPaise  = rupeesToPaise(freight  || '0')
  const gstPaise = lines.reduce((s, l) => {
    const it = items.find((x) => x.id === l.stock_item_id)
    const base = Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0'))
    return s + (it ? Math.round(base * Number(it.gst_rate) / 100) : 0)
  }, 0)
  const taxablePaise  = Math.max(0, linesTotalPaise - discountPaise)
  const scaledGst     = linesTotalPaise > 0 ? Math.round(gstPaise * taxablePaise / linesTotalPaise) : 0
  const grossPaise    = taxablePaise + scaledGst + freightPaise
  const billPaise     = Math.round(grossPaise / 100) * 100
  const roundOffPaise = billPaise - grossPaise

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = lines
      .filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setError('Add at least one item.'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.sell(currentOrgId, date, mode === 'credit' ? party : null, payload, mode, narration, discountPaise, freightPaise)
      setMsg(`Saved · ${res.voucher_no}`)
      setLines([emptyLine()]); setNarration(''); setDiscount(''); setFreight('')
      ;['dashboard', 'daybook', 'invoices', 'items', 'parties', 'trial_balance', 'gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function submitCreditNote(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = cnLines
      .filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setCnError('Add at least one item.'); return }
    if (!cnParty) { setCnError('Select a customer.'); return }
    setCnBusy(true); setCnError(null); setCnMsg(null)
    try {
      const res = await rpc.salesReturn(currentOrgId, cnDate, cnParty, payload, 'credit', cnNarration || undefined)
      setCnMsg(`Saved · ${res.voucher_no}`)
      setCnLines([emptyLine()]); setCnNarration('')
      ;['dashboard', 'daybook', 'credit_notes', 'items', 'parties', 'trial_balance', 'gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
    } catch (err) { setCnError((err as Error).message) } finally { setCnBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Sales" description="Record what you sell and keep track of who still owes you." />

      <Card>
        <h3 className="mb-4 font-semibold">New sale</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Payment">
              <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="credit">On credit</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </Select>
            </Field>
            {mode === 'credit' && (
              <Field label="Customer">
                <Select required value={party} onChange={(e) => setParty(e.target.value)}>
                  <option value="" disabled>Select customer…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
          </div>

          <ItemTable items={items} value={lines} onChange={setLines} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount (₹)">
              <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Freight (₹)">
              <Input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" />
            </Field>
          </div>

          <div className="space-y-1 text-sm border-t border-line pt-3">
            {discountPaise > 0 && (
              <div className="flex justify-between text-muted">
                <span>Subtotal</span><span className="num">{formatINR(linesTotalPaise, false)}</span>
              </div>
            )}
            {discountPaise > 0 && (
              <div className="flex justify-between text-muted">
                <span>− Discount</span><span className="num">{formatINR(discountPaise, false)}</span>
              </div>
            )}
            {discountPaise > 0 && (
              <div className="flex justify-between text-muted">
                <span>Taxable</span><span className="num">{formatINR(taxablePaise, false)}</span>
              </div>
            )}
            {scaledGst > 0 && (
              <div className="flex justify-between text-muted">
                <span>GST</span><span className="num">{formatINR(scaledGst, false)}</span>
              </div>
            )}
            {freightPaise > 0 && (
              <div className="flex justify-between text-muted">
                <span>+ Freight</span><span className="num">{formatINR(freightPaise, false)}</span>
              </div>
            )}
            {roundOffPaise !== 0 && (
              <div className="flex justify-between text-muted">
                <span>Round-off</span>
                <span className="num">{roundOffPaise > 0 ? '+' : '−'}{formatINR(Math.abs(roundOffPaise), false)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t border-line pt-1">
              <span>Bill Amount</span><span className="num">{formatINR(billPaise)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Field label="Note (optional)">
              <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Narration…" />
            </Field>
            <div className="shrink-0">
              <Button type="submit" size="lg" disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</Button>
            </div>
          </div>

          {overLimit && (
            <p className="text-sm text-warn">
              ⚠ This sale puts {selectedParty!.name} over their credit limit
              ({formatINR(selectedParty!.credit_limit)}). You can still save.
            </p>
          )}
          {error && <p className="text-sm text-neg">{error}</p>}
          {msg && <p className="text-sm text-pos">{msg}</p>}
        </form>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold text-neg">New Credit Note (Return)</h3>
        <form onSubmit={submitCreditNote} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input type="date" value={cnDate} onChange={(e) => setCnDate(e.target.value)} required />
            </Field>
            <Field label="Customer">
              <Select required value={cnParty} onChange={(e) => setCnParty(e.target.value)}>
                <option value="" disabled>Select customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <ItemTable items={items} value={cnLines} onChange={setCnLines} />
          <Field label="Reason (optional)">
            <Input value={cnNarration} onChange={(e) => setCnNarration(e.target.value)} placeholder="e.g. Damaged goods returned" />
          </Field>
          {cnError && <p className="text-sm text-neg">{cnError}</p>}
          {cnMsg   && <p className="text-sm text-pos">{cnMsg}</p>}
          <Button type="submit" variant="secondary" className="w-full"
            disabled={cnBusy}>{cnBusy ? 'Saving…' : 'Record credit note'}</Button>
        </form>
      </Card>

      <Card className="p-0">
        <div className="flex border-b border-line">
          {([
            { id: 'invoices' as const, label: 'Invoices' },
            { id: 'credit_notes' as const, label: 'Credit Notes' },
          ]).map((t) => (
            <button key={t.id} type="button" onClick={() => setListTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                listTab === t.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-muted hover:text-ink'
              }`}>
              {t.label}
              {t.id === 'credit_notes' && creditNotes.length > 0 && (
                <span className="ml-1.5 rounded-full bg-warn/10 px-1.5 py-0.5 text-xs font-semibold text-warn">
                  {creditNotes.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          {listTab === 'invoices' ? (
            <table className="tbl">
              <thead><tr><th>No.</th><th>Customer</th><th>Date</th><th className="r">Total</th><th className="r">Due</th></tr></thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="cursor-pointer" onClick={() => navigate(`/sales/${inv.id}`)}>
                    <td className="num">{inv.invoice_no}</td>
                    <td>{partyName(inv.party_id)}</td>
                    <td className="num">{formatDate(inv.date)}</td>
                    <td className="r num bold">{formatINR(inv.total, false)}</td>
                    <td className={`r num ${inv.outstanding > 0 ? 'text-warn' : 'text-pos'}`}>
                      {inv.outstanding > 0 ? formatINR(inv.outstanding, false) : 'Paid'}
                    </td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr><td colSpan={5} className="py-6 text-center text-muted">No invoices yet.</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="tbl">
              <thead><tr><th>No.</th><th>Customer</th><th>Date</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {creditNotes.map((cn) => (
                  <tr key={cn.voucher_id}>
                    <td className="num text-neg">{cn.voucher_no}</td>
                    <td>{cn.party_name ?? '—'}</td>
                    <td className="num">{formatDate(cn.date)}</td>
                    <td className="r num bold text-neg">{formatINR(cn.amount, false)}</td>
                  </tr>
                ))}
                {!creditNotes.length && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted">No credit notes yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  )
}
