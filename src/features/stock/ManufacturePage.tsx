import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useItems, type Item } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Select, Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'

const today = () => new Date().toISOString().slice(0, 10)

type InRow = { stock_item_id: string; qty: string }
type OutRow = { stock_item_id: string; qty: string; weight: string }
const emptyIn = (): InRow => ({ stock_item_id: '', qty: '' })
const emptyOut = (): OutRow => ({ stock_item_id: '', qty: '', weight: '1' })

export function ManufacturePage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const { data: items = [] } = useItems(currentOrgId)
  const byId = (id: string) => items.find((i: Item) => i.id === id)

  const [date, setDate] = useState(today())
  const [inputs, setInputs] = useState<InRow[]>([emptyIn()])
  const [outputs, setOutputs] = useState<OutRow[]>([emptyOut()])
  const [narration, setNarration] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // total material cost (paise) from current avg_cost
  const inCost = (r: InRow) => {
    const it = byId(r.stock_item_id)
    return it ? Math.round(Number(r.qty || 0) * Number(it.avg_cost)) : 0
  }
  const totalRm = inputs.reduce((s, r) => s + inCost(r), 0)
  const totalWeight = outputs.reduce((s, r) => s + Number(r.weight || 0), 0)
  // preview allocation (last output absorbs remainder — mirrors the RPC)
  const allocFor = (idx: number) => {
    if (totalWeight <= 0 || totalRm <= 0) return 0
    if (idx < outputs.length - 1) return Math.round(totalRm * Number(outputs[idx].weight || 0) / totalWeight)
    const prior = outputs.slice(0, -1).reduce((s, r) => s + Math.round(totalRm * Number(r.weight || 0) / totalWeight), 0)
    return totalRm - prior
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    const inPayload = inputs
      .filter((r) => r.stock_item_id && Number(r.qty) > 0)
      .map((r) => ({ stock_item_id: r.stock_item_id, qty: Number(r.qty) }))
    const outPayload = outputs
      .filter((r) => r.stock_item_id && Number(r.qty) > 0)
      .map((r) => ({ stock_item_id: r.stock_item_id, qty: Number(r.qty), weight: Number(r.weight || 1) }))
    if (!inPayload.length || !outPayload.length) { setError('Add at least one input and one output.'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await rpc.manufacture(currentOrgId, date, inPayload, outPayload, narration)
      setMsg(`Saved · ${res.voucher_no}`)
      setInputs([emptyIn()]); setOutputs([emptyOut()]); setNarration('')
      ;['dashboard', 'daybook', 'items', 'stock_ledger', 'inv_recon'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const setIn = (i: number, patch: Partial<InRow>) =>
    setInputs(inputs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const setOut = (i: number, patch: Partial<OutRow>) =>
    setOutputs(outputs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-5">
      <PageHeader title="Manufacture" description="Turn raw materials into finished goods — cost flows across automatically." />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>

          {/* Inputs consumed */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Materials consumed</p>
            {inputs.map((r, i) => {
              const it = byId(r.stock_item_id)
              return (
                <div key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <Select className="h-10 flex-1" value={r.stock_item_id} onChange={(e) => setIn(i, { stock_item_id: e.target.value })}>
                      <option value="" disabled>Select item…</option>
                      {items.map((opt: Item) => <option key={opt.id} value={opt.id}>{opt.name} ({opt.unit})</option>)}
                    </Select>
                    <button type="button" onClick={() => setInputs(inputs.filter((_, idx) => idx !== i))} className="text-muted hover:text-neg"><Trash2 size={18} /></button>
                  </div>
                  <label className="mt-2 block text-xs text-muted">
                    Qty {it ? `(${it.unit})` : ''}
                    <Input className="h-10" inputMode="decimal" value={r.qty} onChange={(e) => setIn(i, { qty: e.target.value })} placeholder="0" />
                  </label>
                  {it && Number(r.qty) > 0 && (
                    <p className="mt-1.5 text-xs text-muted">Cost <span className="num">{formatINR(inCost(r))}</span> @ {formatINR(Number(it.avg_cost), false)}/{it.unit}</p>
                  )}
                </div>
              )
            })}
            <button type="button" onClick={() => setInputs([...inputs, emptyIn()])} className="flex items-center gap-1.5 text-sm font-medium text-brand-600"><Plus size={16} /> Add material</button>
          </div>

          {/* Outputs produced */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Finished goods produced</p>
            {outputs.map((r, i) => {
              const it = byId(r.stock_item_id)
              const alloc = allocFor(i)
              return (
                <div key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <Select className="h-10 flex-1" value={r.stock_item_id} onChange={(e) => setOut(i, { stock_item_id: e.target.value })}>
                      <option value="" disabled>Select item…</option>
                      {items.map((opt: Item) => <option key={opt.id} value={opt.id}>{opt.name} ({opt.unit})</option>)}
                    </Select>
                    <button type="button" onClick={() => setOutputs(outputs.filter((_, idx) => idx !== i))} className="text-muted hover:text-neg"><Trash2 size={18} /></button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs text-muted">Qty {it ? `(${it.unit})` : ''}
                      <Input className="h-10" inputMode="decimal" value={r.qty} onChange={(e) => setOut(i, { qty: e.target.value })} placeholder="0" />
                    </label>
                    <label className="text-xs text-muted">Cost weight
                      <Input className="h-10" inputMode="decimal" value={r.weight} onChange={(e) => setOut(i, { weight: e.target.value })} placeholder="1" />
                    </label>
                  </div>
                  {it && Number(r.qty) > 0 && alloc > 0 && (
                    <p className="mt-1.5 text-xs text-muted">Value <span className="num">{formatINR(alloc)}</span> · {formatINR(Math.round(alloc / Number(r.qty)), false)}/{it.unit}</p>
                  )}
                </div>
              )
            })}
            <button type="button" onClick={() => setOutputs([...outputs, emptyOut()])} className="flex items-center gap-1.5 text-sm font-medium text-brand-600"><Plus size={16} /> Add finished good</button>
          </div>

          <div className="flex justify-between border-t border-line pt-2 text-sm">
            <span className="text-muted">Total material cost</span>
            <span className="num font-medium">{formatINR(totalRm)}</span>
          </div>

          <Field label="Note (optional)"><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
          {error && <p className="text-sm text-neg">{error}</p>}
          {msg && <p className="text-sm text-pos">{msg}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Record manufacture'}</Button>
        </form>
      </Card>
    </div>
  )
}
