import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useItems } from '@/hooks/queries'
import { rpc } from '@/lib/rpc'
import { formatINR, rupeesToPaise } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'

const today = () => new Date().toISOString().slice(0, 10)
const ITEM_TYPES = [
  { id: 1, label: 'Raw material' }, { id: 2, label: 'Finished good' },
  { id: 3, label: 'Consumable' }, { id: 4, label: 'Trading good' },
]
const GST_RATES = [0, 5, 12, 18, 28]

export function ItemsPage() {
  const { currentOrgId } = useAuth()
  const qc = useQueryClient()
  const { data: items = [] } = useItems(currentOrgId)

  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState(4)
  const [unit, setUnit] = useState('pcs')
  const [hsn, setHsn] = useState('')
  const [gst, setGst] = useState(18)
  const [min, setMin] = useState('')
  // more
  const [code, setCode] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [openQty, setOpenQty] = useState('')
  const [openRate, setOpenRate] = useState('')
  const [openDate, setOpenDate] = useState(today())

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setName(''); setHsn(''); setMin(''); setUnit('pcs'); setGst(18); setType(4)
    setCode(''); setCategory(''); setDescription(''); setSalePrice(''); setPurchasePrice('')
    setOpenQty(''); setOpenRate(''); setOpenDate(today()); setMore(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentOrgId) return
    setBusy(true); setError(null)
    const details: Record<string, unknown> = {
      item_code: code || null, category: category || null, description: description || null,
      sale_price: salePrice ? rupeesToPaise(salePrice) : 0,
      purchase_price: purchasePrice ? rupeesToPaise(purchasePrice) : 0,
    }
    const opening = openQty && Number(openQty) > 0
      ? { qty: Number(openQty), rate: openRate ? rupeesToPaise(openRate) : 0, date: openDate }
      : undefined
    try {
      await rpc.createStockItem(currentOrgId, name, type, unit, Number(min || 0), hsn || undefined, gst, details, opening)
      setOpen(false); resetForm()
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['trial_balance'] })
      qc.invalidateQueries({ queryKey: ['inv_recon'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Items"
        description="Everything you buy, make, or sell — with stock, pricing, and tax."
        action={
          <Button onClick={() => setOpen((o) => !o)} variant={open ? 'secondary' : 'primary'}>
            {open ? 'Close' : '+ New item'}
          </Button>
        }
      />

      {open && (
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
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
            </div>

            <button type="button" onClick={() => setMore((m) => !m)}
              className="flex items-center gap-1 text-sm font-medium text-brand-600">
              {more ? <ChevronDown size={16} /> : <ChevronRight size={16} />} More details
            </button>

            {more && (
              <div className="grid gap-3 rounded-xl border border-line bg-surface p-3 md:grid-cols-2">
                <Field label="Item code / SKU / barcode"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
                <Field label="Sale price (₹)"><Input value={salePrice} onChange={(e) => setSalePrice(e.target.value)} inputMode="decimal" /></Field>
                <Field label="Purchase price (₹)"><Input value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} inputMode="decimal" /></Field>
                <div className="md:col-span-2">
                  <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
                </div>
                <div className="md:col-span-2 grid grid-cols-3 gap-2">
                  <Field label="Opening qty"><Input value={openQty} onChange={(e) => setOpenQty(e.target.value)} inputMode="decimal" /></Field>
                  <Field label="Opening rate (₹)"><Input value={openRate} onChange={(e) => setOpenRate(e.target.value)} inputMode="decimal" /></Field>
                  <Field label="As on"><Input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} /></Field>
                </div>
              </div>
            )}

            <div className="flex items-center">
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
              <tr><th>Item</th><th>Code</th><th>HSN</th><th className="r">GST</th><th className="r">In stock</th><th className="r">Avg cost</th><th className="r">Stock value</th></tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const low = it.qty_on_hand <= it.min_level && it.min_level > 0
                return (
                  <tr key={it.id}>
                    <td className="font-medium">{it.name}<span className="ml-1 text-xs text-muted">({it.unit})</span></td>
                    <td className="num text-muted">{it.item_code ?? '—'}</td>
                    <td className="num text-muted">{it.hsn ?? '—'}</td>
                    <td className="r num text-muted">{it.gst_rate}%</td>
                    <td className={`r num ${low ? 'text-warn' : ''}`}>{it.qty_on_hand}{low ? ' ⚠' : ''}</td>
                    <td className="r num text-muted">{formatINR(it.avg_cost, false)}</td>
                    <td className="r num bold">{formatINR(it.value_on_hand, false)}</td>
                  </tr>
                )
              })}
              {!items.length && <tr><td colSpan={7} className="py-6 text-center text-muted">No items yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
