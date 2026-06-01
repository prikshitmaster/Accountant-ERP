import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useItems } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'

const ITEM_TYPES = [
  { id: 1, label: 'Raw material' },
  { id: 2, label: 'Finished good' },
  { id: 3, label: 'Consumable' },
  { id: 4, label: 'Trading good' },
]
const GST_RATES = [0, 5, 12, 18, 28]

export function ItemsPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const { data: items = [] } = useItems(currentOrgId)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState(4)
  const [unit, setUnit] = useState('pcs')
  const [hsn, setHsn] = useState('')
  const [gst, setGst] = useState(18)
  const [min, setMin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    setBusy(true); setError(null)
    try {
      await rpc.createStockItem(currentOrgId, name, type, unit, Number(min || 0), hsn || undefined, gst)
      setOpen(false); setName(''); setHsn(''); setMin(''); setUnit('pcs'); setGst(18); setType(4)
      qc.invalidateQueries({ queryKey: ['items'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Items</h2>
        <Button onClick={() => setOpen((o) => !o)} variant={open ? 'secondary' : 'primary'}>
          {open ? 'Close' : '+ New item'}
        </Button>
      </div>

      {open && (
        <Card>
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Type">
              <Select value={type} onChange={(e) => setType(Number(e.target.value))}>
                {ITEM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Unit"><Input required value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, pcs, bag…" /></Field>
            <Field label="HSN / SAC"><Input value={hsn} onChange={(e) => setHsn(e.target.value)} inputMode="numeric" /></Field>
            <Field label="GST rate">
              <Select value={gst} onChange={(e) => setGst(Number(e.target.value))}>
                {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
              </Select>
            </Field>
            <Field label="Low-stock alert at"><Input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" placeholder="0" /></Field>
            <div className="flex items-end md:col-span-2">
              {error && <p className="text-sm text-neg">{error}</p>}
              <Button type="submit" className="ml-auto" disabled={busy}>{busy ? 'Saving…' : 'Save item'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Item</th><th>HSN</th><th className="r">GST</th><th className="r">In stock</th><th className="r">Avg cost</th><th className="r">Stock value</th></tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const low = it.qty_on_hand <= it.min_level && it.min_level > 0
                return (
                  <tr key={it.id}>
                    <td className="font-medium">{it.name}<span className="ml-1 text-xs text-muted">({it.unit})</span></td>
                    <td className="num text-muted">{it.hsn ?? '—'}</td>
                    <td className="r num text-muted">{it.gst_rate}%</td>
                    <td className={`r num ${low ? 'text-warn' : ''}`}>{it.qty_on_hand}{low ? ' ⚠' : ''}</td>
                    <td className="r num">{formatINR(it.avg_cost, false)}</td>
                    <td className="r num">{formatINR(it.value_on_hand, false)}</td>
                  </tr>
                )
              })}
              {!items.length && <tr><td colSpan={6} className="py-6 text-center text-muted">No items yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
