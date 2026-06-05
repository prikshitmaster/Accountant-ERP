import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useParties, useItems, useBills, useDebitNotes } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { rupeesToPaise, formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { ItemLines, emptyLine, lineError, type Line } from '@/components/ItemLines'
import { PageHeader } from '@/components/ui/PageHeader'

const today = () => new Date().toISOString().slice(0, 10)
const PAGE_SIZE = 15

export function PurchasesPage() {
  const { currentOrgId } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: suppliers = [] } = useParties(currentOrgId, 'supplier')
  const { data: items = [] }     = useItems(currentOrgId)
  const { data: bills = [] }     = useBills(currentOrgId)
  const { data: debitNotes = [] } = useDebitNotes(currentOrgId)

  // List state
  const [listTab, setListTab]   = useState<'bills' | 'debit_notes'>('bills')
  const [showForm, setShowForm] = useState(false)
  const [billPage, setBillPage] = useState(0)
  const [dnPage,   setDnPage]   = useState(0)

  function switchTab(t: 'bills' | 'debit_notes') {
    setListTab(t); setShowForm(false); setBillPage(0); setDnPage(0)
  }

  // Bill form
  const [date,      setDate]      = useState(today())
  const [mode,      setMode]      = useState<'credit'|'cash'|'bank'>('credit')
  const [party,     setParty]     = useState('')
  const [lines,     setLines]     = useState<Line[]>([emptyLine()])
  const [narration, setNarration] = useState('')
  const [busy,      setBusy]      = useState(false)
  const [msg,       setMsg]       = useState<string | null>(null)
  const [error,     setError]     = useState<string | null>(null)

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
      const res = await rpc.purchase(currentOrgId, date, mode === 'credit' ? party : null, payload, mode, narration)
      setMsg(`Saved · ${res.voucher_no}`)
      setLines([emptyLine()]); setNarration('')
      ;['dashboard','daybook','bills','items','parties','trial_balance','gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
      setTimeout(() => { setShowForm(false); setMsg(null) }, 1500)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  // Debit note form
  const [dnDate,      setDnDate]      = useState(today())
  const [dnParty,     setDnParty]     = useState('')
  const [dnLines,     setDnLines]     = useState<Line[]>([emptyLine()])
  const [dnNarration, setDnNarration] = useState('')
  const [dnBusy,      setDnBusy]      = useState(false)
  const [dnMsg,       setDnMsg]       = useState<string | null>(null)
  const [dnError,     setDnError]     = useState<string | null>(null)

  async function submitDebitNote(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const payload = dnLines.filter((l) => l.stock_item_id && Number(l.qty) > 0)
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), rate: rupeesToPaise(l.rate) }))
    if (!payload.length) { setDnError('Add at least one item.'); return }
    if (!dnParty) { setDnError('Select a supplier.'); return }
    setDnBusy(true); setDnError(null); setDnMsg(null)
    try {
      const res = await rpc.purchaseReturn(currentOrgId, dnDate, dnParty, payload, 'credit', dnNarration || undefined)
      setDnMsg(`Saved · ${res.voucher_no}`)
      setDnLines([emptyLine()]); setDnNarration('')
      ;['dashboard','daybook','debit_notes','items','parties','trial_balance','gst'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
      setTimeout(() => { setShowForm(false); setDnMsg(null) }, 1500)
    } catch (err) { setDnError((err as Error).message) } finally { setDnBusy(false) }
  }

  const partyName = (id: string) => suppliers.find((p) => p.id === id)?.name ?? '—'

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Purchases" description="Record what you buy and what you still owe your suppliers." />
        <button
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + {listTab === 'bills' ? 'New Purchase' : 'New Debit Note'}
        </button>
      </div>

      {/* Collapsible form */}
      {showForm && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">
              {listTab === 'bills' ? 'New Purchase' : 'New Debit Note (Return)'}
            </h3>
            <button onClick={() => setShowForm(false)} className="text-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>

          {listTab === 'bills' ? (
            <form onSubmit={submit} className="space-y-3">
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
                  <Field label="Supplier">
                    <Select required value={party} onChange={(e) => setParty(e.target.value)}>
                      <option value="" disabled>Select supplier…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
              <ItemLines items={items} value={lines} onChange={setLines} rateLabel="Cost price" priceField="purchase_price" />
              <Field label="Note (optional)"><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
              {error && <p className="text-sm text-neg">{error}</p>}
              {msg   && <p className="text-sm text-pos">{msg}</p>}
              <div className="flex gap-3">
                <Button type="submit" size="lg" className="flex-1" disabled={busy}>{busy ? 'Saving…' : 'Record purchase'}</Button>
                <Button type="button" variant="secondary" size="lg" onClick={() => setShowForm(false)}>Discard</Button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitDebitNote} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date"><Input type="date" value={dnDate} onChange={(e) => setDnDate(e.target.value)} required /></Field>
                <Field label="Supplier">
                  <Select required value={dnParty} onChange={(e) => setDnParty(e.target.value)}>
                    <option value="" disabled>Select supplier…</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
              </div>
              <ItemLines items={items} value={dnLines} onChange={setDnLines} rateLabel="Return rate" priceField="purchase_price" />
              <Field label="Reason (optional)">
                <Input value={dnNarration} onChange={(e) => setDnNarration(e.target.value)} placeholder="e.g. Wrong goods received" />
              </Field>
              {dnError && <p className="text-sm text-neg">{dnError}</p>}
              {dnMsg   && <p className="text-sm text-pos">{dnMsg}</p>}
              <div className="flex gap-3">
                <Button type="submit" variant="secondary" size="lg" className="flex-1" disabled={dnBusy}>{dnBusy ? 'Saving…' : 'Record debit note'}</Button>
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
            { id: 'bills' as const,       label: 'Bills',       badge: 0 },
            { id: 'debit_notes' as const, label: 'Debit Notes', badge: debitNotes.length },
          ]).map((t) => (
            <button key={t.id} type="button" onClick={() => switchTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                listTab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted hover:text-ink'
              }`}>
              {t.label}
              {t.badge > 0 && (
                <span className="ml-1.5 rounded-full bg-warn/10 px-1.5 py-0.5 text-xs font-semibold text-warn">{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {listTab === 'bills' ? (() => {
            const totalPages = Math.ceil(bills.length / PAGE_SIZE) || 1
            const paged = bills.slice(billPage * PAGE_SIZE, (billPage + 1) * PAGE_SIZE)
            return (
              <>
                <table className="tbl">
                  <thead><tr><th>No.</th><th>Supplier</th><th>Date</th><th className="r">Total</th><th className="r">Due</th></tr></thead>
                  <tbody>
                    {paged.map((b) => (
                      <tr key={b.id} className="cursor-pointer" onClick={() => navigate('/purchases/' + b.id)}>
                        <td className="num">{b.bill_no}</td>
                        <td>{partyName(b.party_id)}</td>
                        <td className="num">{formatDate(b.date)}</td>
                        <td className="r num bold">{formatINR(b.total, false)}</td>
                        <td className={`r num ${b.outstanding > 0 ? 'text-warn' : 'text-pos'}`}>
                          {b.outstanding > 0 ? formatINR(b.outstanding, false) : 'Paid'}
                        </td>
                      </tr>
                    ))}
                    {!bills.length && <tr><td colSpan={5} className="py-8 text-center text-muted">No bills yet.</td></tr>}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
                    <span>{billPage * PAGE_SIZE + 1}–{Math.min((billPage + 1) * PAGE_SIZE, bills.length)} of {bills.length}</span>
                    <div className="flex gap-1">
                      <button disabled={billPage === 0} onClick={() => setBillPage((p) => p - 1)} className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">← Prev</button>
                      <button disabled={billPage >= totalPages - 1} onClick={() => setBillPage((p) => p + 1)} className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">Next →</button>
                    </div>
                  </div>
                )}
              </>
            )
          })() : (() => {
            const totalPages = Math.ceil(debitNotes.length / PAGE_SIZE) || 1
            const paged = debitNotes.slice(dnPage * PAGE_SIZE, (dnPage + 1) * PAGE_SIZE)
            return (
              <>
                <table className="tbl">
                  <thead><tr><th>No.</th><th>Supplier</th><th>Date</th><th className="r">Amount</th></tr></thead>
                  <tbody>
                    {paged.map((dn) => (
                      <tr key={dn.voucher_id}>
                        <td className="num text-pos">{dn.voucher_no}</td>
                        <td>{dn.party_name ?? '—'}</td>
                        <td className="num">{formatDate(dn.date)}</td>
                        <td className="r num bold text-pos">{formatINR(dn.amount, false)}</td>
                      </tr>
                    ))}
                    {!debitNotes.length && <tr><td colSpan={4} className="py-8 text-center text-muted">No debit notes yet.</td></tr>}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
                    <span>{dnPage * PAGE_SIZE + 1}–{Math.min((dnPage + 1) * PAGE_SIZE, debitNotes.length)} of {debitNotes.length}</span>
                    <div className="flex gap-1">
                      <button disabled={dnPage === 0} onClick={() => setDnPage((p) => p - 1)} className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">← Prev</button>
                      <button disabled={dnPage >= totalPages - 1} onClick={() => setDnPage((p) => p + 1)} className="rounded px-2 py-1 hover:bg-canvas disabled:opacity-30">Next →</button>
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </Card>
    </div>
  )
}
