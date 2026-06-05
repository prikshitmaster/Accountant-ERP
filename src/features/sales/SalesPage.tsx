import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useParties, useItems, useInvoices, useCreditNotes } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { ItemTable, emptyLine, lineError, type Line } from '@/components/ItemTable'
import { InvoiceDrawer } from './InvoiceDrawer'

const today = () => new Date().toISOString().slice(0, 10)
const PAGE_SIZE = 15

export function SalesPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const { data: customers = [] }  = useParties(currentOrgId, 'customer')
  const { data: items = [] }      = useItems(currentOrgId)
  const { data: invoices = [] }   = useInvoices(currentOrgId)
  const { data: creditNotes = [] } = useCreditNotes(currentOrgId)

  // List state
  const [listTab,   setListTab]   = useState<'invoices' | 'credit_notes'>('invoices')
  const [showForm,  setShowForm]  = useState(false)
  const [invPage,   setInvPage]   = useState(0)
  const [cnPage,    setCnPage]    = useState(0)
  const [drawerInvId, setDrawerInvId] = useState<string | null>(null)

  function switchTab(t: 'invoices' | 'credit_notes') {
    setListTab(t); setShowForm(false); setInvPage(0); setCnPage(0)
  }

  // Invoice form
  const [date,      setDate]      = useState(today())
  const [mode,      setMode]      = useState<'credit'|'cash'|'bank'>('credit')
  const [party,     setParty]     = useState('')
  const [lines,     setLines]     = useState<Line[]>([emptyLine()])
  const [narration, setNarration] = useState('')
  const [discount,  setDiscount]  = useState('')
  const [freight,   setFreight]   = useState('')
  const [busy,      setBusy]      = useState(false)
  const [msg,       setMsg]       = useState<string | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  const selectedParty   = customers.find((p) => p.id === party)
  const linesTotalPaise = lines.reduce((s, l) => s + Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0')), 0)
  const discountPaise   = rupeesToPaise(discount || '0')
  const freightPaise    = rupeesToPaise(freight  || '0')
  const gstPaise        = lines.reduce((s, l) => {
    const it   = items.find((x) => x.id === l.stock_item_id)
    const base = Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0'))
    return s + (it ? Math.round(base * Number(it.gst_rate) / 100) : 0)
  }, 0)
  const taxablePaise    = Math.max(0, linesTotalPaise - discountPaise)
  const scaledGst       = linesTotalPaise > 0 ? Math.round(gstPaise * taxablePaise / linesTotalPaise) : 0
  const grossPaise      = taxablePaise + scaledGst + freightPaise
  const billPaise       = Math.round(grossPaise / 100) * 100
  const roundOffPaise   = billPaise - grossPaise
  const overLimit       = mode === 'credit' && selectedParty &&
    selectedParty.credit_limit > 0 && selectedParty.balance + linesTotalPaise > selectedParty.credit_limit

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = lines.filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setError('Add at least one item.'); return }
    const bad = lines.find(lineError)
    if (bad) { setError(lineError(bad)!); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.sell(currentOrgId, date, mode === 'credit' ? party : null, payload, mode, narration, discountPaise, freightPaise)
      setMsg(`Saved · ${res.voucher_no}`)
      setLines([emptyLine()]); setNarration(''); setDiscount(''); setFreight('')
      ;['dashboard','daybook','invoices','items','parties','trial_balance','gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
      setTimeout(() => { setShowForm(false); setMsg(null) }, 1500)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  // Credit note form
  const [cnDate,      setCnDate]      = useState(today())
  const [cnParty,     setCnParty]     = useState('')
  const [cnLines,     setCnLines]     = useState<Line[]>([emptyLine()])
  const [cnNarration, setCnNarration] = useState('')
  const [cnBusy,      setCnBusy]      = useState(false)
  const [cnMsg,       setCnMsg]       = useState<string | null>(null)
  const [cnError,     setCnError]     = useState<string | null>(null)

  async function submitCreditNote(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = cnLines.filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setCnError('Add at least one item.'); return }
    if (!cnParty) { setCnError('Select a customer.'); return }
    setCnBusy(true); setCnError(null); setCnMsg(null)
    try {
      const res = await rpc.salesReturn(currentOrgId, cnDate, cnParty, payload, 'credit', cnNarration || undefined)
      setCnMsg(`Saved · ${res.voucher_no}`)
      setCnLines([emptyLine()]); setCnNarration('')
      ;['dashboard','daybook','credit_notes','items','parties','trial_balance','gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
      setTimeout(() => { setShowForm(false); setCnMsg(null) }, 1500)
    } catch (err) { setCnError((err as Error).message) } finally { setCnBusy(false) }
  }

  const partyName = (id: string) => customers.find((p) => p.id === id)?.name ?? '—'

  const totalBilled    = invoices.reduce((s, i) => s + i.total, 0)
  const totalCollected = invoices.reduce((s, i) => s + (i.total - i.outstanding), 0)
  const totalDue       = invoices.reduce((s, i) => s + i.outstanding, 0)

  return (
    <div className="space-y-4">
      {/* Page header — green identity */}
      <div className="rounded-xl bg-emerald-600 px-5 py-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-emerald-200">Sales</p>
            <h1 className="mt-0.5 text-2xl font-bold">Invoices & Returns</h1>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="shrink-0 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 border border-white/20"
          >
            + {listTab === 'invoices' ? 'New Sale' : 'New Credit Note'}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-white/10 px-3 py-2.5">
            <p className="text-xs text-emerald-200">Total Billed</p>
            <p className="num mt-0.5 text-lg font-semibold">{formatINR(totalBilled, false)}</p>
          </div>
          <div className="rounded-lg bg-white/10 px-3 py-2.5">
            <p className="text-xs text-emerald-200">Collected</p>
            <p className="num mt-0.5 text-lg font-semibold">{formatINR(totalCollected, false)}</p>
          </div>
          <div className="rounded-lg bg-white/10 px-3 py-2.5">
            <p className="text-xs text-emerald-200">Outstanding</p>
            <p className={`num mt-0.5 text-lg font-semibold ${totalDue > 0 ? 'text-yellow-300' : 'text-white'}`}>{formatINR(totalDue, false)}</p>
          </div>
        </div>
      </div>

      {/* Collapsible form */}
      {showForm && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">
              {listTab === 'invoices' ? 'New Sale' : 'New Credit Note (Return)'}
            </h3>
            <button onClick={() => setShowForm(false)} className="text-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>

          {listTab === 'invoices' ? (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
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
                <Field label="Discount (₹)"><Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
                <Field label="Freight (₹)"><Input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" /></Field>
              </div>

              <div className="space-y-1 text-sm border-t border-line pt-3">
                {discountPaise > 0 && <>
                  <div className="flex justify-between text-muted"><span>Subtotal</span><span className="num">{formatINR(linesTotalPaise, false)}</span></div>
                  <div className="flex justify-between text-muted"><span>− Discount</span><span className="num">{formatINR(discountPaise, false)}</span></div>
                  <div className="flex justify-between text-muted"><span>Taxable</span><span className="num">{formatINR(taxablePaise, false)}</span></div>
                </>}
                {scaledGst > 0 && <div className="flex justify-between text-muted"><span>GST</span><span className="num">{formatINR(scaledGst, false)}</span></div>}
                {freightPaise > 0 && <div className="flex justify-between text-muted"><span>+ Freight</span><span className="num">{formatINR(freightPaise, false)}</span></div>}
                {roundOffPaise !== 0 && <div className="flex justify-between text-muted"><span>Round-off</span><span className="num">{roundOffPaise > 0 ? '+' : '−'}{formatINR(Math.abs(roundOffPaise), false)}</span></div>}
                <div className="flex justify-between font-semibold border-t border-line pt-1"><span>Bill Amount</span><span className="num">{formatINR(billPaise)}</span></div>
              </div>

              {overLimit && <p className="text-sm text-warn">⚠ This sale puts {selectedParty!.name} over their credit limit ({formatINR(selectedParty!.credit_limit)}). You can still save.</p>}

              <Field label="Note (optional)"><Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Narration…" /></Field>
              {error && <p className="text-sm text-neg">{error}</p>}
              {msg   && <p className="text-sm text-pos">{msg}</p>}
              <div className="flex gap-3">
                <Button type="submit" size="lg" className="flex-1" disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</Button>
                <Button type="button" variant="secondary" size="lg" onClick={() => setShowForm(false)}>Discard</Button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitCreditNote} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date"><Input type="date" value={cnDate} onChange={(e) => setCnDate(e.target.value)} required /></Field>
                <Field label="Customer">
                  <Select required value={cnParty} onChange={(e) => setCnParty(e.target.value)}>
                    <option value="" disabled>Select customer…</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
              </div>
              <ItemTable items={items} value={cnLines} onChange={setCnLines} />
              <Field label="Reason (optional)"><Input value={cnNarration} onChange={(e) => setCnNarration(e.target.value)} placeholder="e.g. Damaged goods returned" /></Field>
              {cnError && <p className="text-sm text-neg">{cnError}</p>}
              {cnMsg   && <p className="text-sm text-pos">{cnMsg}</p>}
              <div className="flex gap-3">
                <Button type="submit" variant="secondary" size="lg" className="flex-1" disabled={cnBusy}>{cnBusy ? 'Saving…' : 'Record credit note'}</Button>
                <Button type="button" variant="secondary" size="lg" onClick={() => setShowForm(false)}>Discard</Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {/* Full-width list */}
      <Card className="p-0">
        <div className="flex border-b border-line">
          {([
            { id: 'invoices' as const,     label: 'Invoices',      badge: 0 },
            { id: 'credit_notes' as const, label: 'Credit Notes',  badge: creditNotes.length },
          ]).map((t) => (
            <button key={t.id} type="button" onClick={() => switchTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                listTab === t.id ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-muted hover:text-ink'
              }`}>
              {t.label}
              {t.badge > 0 && (
                <span className="ml-1.5 rounded-full bg-warn/10 px-1.5 py-0.5 text-xs font-semibold text-warn">{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {listTab === 'invoices' ? (() => {
            const totalPages = Math.ceil(invoices.length / PAGE_SIZE) || 1
            const paged = invoices.slice(invPage * PAGE_SIZE, (invPage + 1) * PAGE_SIZE)
            return (
              <>
                <table className="tbl">
                  <thead><tr><th>No.</th><th>Customer</th><th>Date</th><th className="r">Total</th><th className="r">Due</th></tr></thead>
                  <tbody>
                    {paged.map((inv) => (
                      <tr key={inv.id} className="cursor-pointer" onClick={() => setDrawerInvId(inv.id)}>
                        <td className="num">{inv.invoice_no}</td>
                        <td>{partyName(inv.party_id)}</td>
                        <td className="num">{formatDate(inv.date)}</td>
                        <td className="r num bold">{formatINR(inv.total, false)}</td>
                        <td className={`r num ${inv.outstanding > 0 ? 'text-warn' : 'text-pos'}`}>
                          {inv.outstanding > 0 ? formatINR(inv.outstanding, false) : 'Paid'}
                        </td>
                      </tr>
                    ))}
                    {!invoices.length && <tr><td colSpan={5} className="py-8 text-center text-muted">No invoices yet.</td></tr>}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
                    <span>{invPage * PAGE_SIZE + 1}–{Math.min((invPage + 1) * PAGE_SIZE, invoices.length)} of {invoices.length}</span>
                    <div className="flex gap-1">
                      <button disabled={invPage === 0} onClick={() => setInvPage((p) => p - 1)} className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">← Prev</button>
                      <button disabled={invPage >= totalPages - 1} onClick={() => setInvPage((p) => p + 1)} className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">Next →</button>
                    </div>
                  </div>
                )}
              </>
            )
          })() : (() => {
            const totalPages = Math.ceil(creditNotes.length / PAGE_SIZE) || 1
            const paged = creditNotes.slice(cnPage * PAGE_SIZE, (cnPage + 1) * PAGE_SIZE)
            return (
              <>
                <table className="tbl">
                  <thead><tr><th>No.</th><th>Customer</th><th>Date</th><th className="r">Amount</th></tr></thead>
                  <tbody>
                    {paged.map((cn) => (
                      <tr key={cn.voucher_id}>
                        <td className="num text-neg">{cn.voucher_no}</td>
                        <td>{cn.party_name ?? '—'}</td>
                        <td className="num">{formatDate(cn.date)}</td>
                        <td className="r num bold text-neg">{formatINR(cn.amount, false)}</td>
                      </tr>
                    ))}
                    {!creditNotes.length && <tr><td colSpan={4} className="py-8 text-center text-muted">No credit notes yet.</td></tr>}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
                    <span>{cnPage * PAGE_SIZE + 1}–{Math.min((cnPage + 1) * PAGE_SIZE, creditNotes.length)} of {creditNotes.length}</span>
                    <div className="flex gap-1">
                      <button disabled={cnPage === 0} onClick={() => setCnPage((p) => p - 1)} className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">← Prev</button>
                      <button disabled={cnPage >= totalPages - 1} onClick={() => setCnPage((p) => p + 1)} className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">Next →</button>
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </Card>

      <InvoiceDrawer invoiceId={drawerInvId} onClose={() => setDrawerInvId(null)} />
    </div>
  )
}
