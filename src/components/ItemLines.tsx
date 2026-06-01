import { Trash2, Plus } from 'lucide-react'
import type { Item } from '@/hooks/queries'
import { Select, Input } from '@/components/ui/Input'
import { formatINR, rupeesToPaise } from '@/lib/money'

export type Line = { stock_item_id: string; qty: string; rate: string }
export const emptyLine = (): Line => ({ stock_item_id: '', qty: '', rate: '' })

/** Editor for sale/purchase lines. Computes base + GST preview. */
export function ItemLines({
  items, value, onChange, rateLabel,
}: {
  items: Item[]
  value: Line[]
  onChange: (lines: Line[]) => void
  rateLabel: string
}) {
  const set = (i: number, patch: Partial<Line>) =>
    onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const add = () => onChange([...value, emptyLine()])
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  const itemById = (id: string) => items.find((it) => it.id === id)
  const lineBase = (l: Line) => rupeesToPaise(l.qty || '0') / 100 * rupeesToPaise(l.rate || '0')
  // base in paise = qty * rate(paise). qty is unit count (may be fractional).
  const basePaise = (l: Line) => Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0'))
  const gstPaise = (l: Line) => {
    const it = itemById(l.stock_item_id)
    return it ? Math.round((basePaise(l) * Number(it.gst_rate)) / 100) : 0
  }
  void lineBase

  const subtotal = value.reduce((s, l) => s + basePaise(l), 0)
  const gst = value.reduce((s, l) => s + gstPaise(l), 0)

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {value.map((l, i) => {
          const it = itemById(l.stock_item_id)
          return (
            <div key={i} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <Select
                  className="h-10 flex-1"
                  value={l.stock_item_id}
                  onChange={(e) => set(i, { stock_item_id: e.target.value, rate: l.rate || '' })}
                >
                  <option value="" disabled>Select item…</option>
                  {items.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.name} ({opt.unit})</option>
                  ))}
                </Select>
                <button type="button" onClick={() => remove(i)} className="text-muted hover:text-neg">
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs text-muted">
                  Qty {it ? `(${it.unit})` : ''}
                  <Input className="h-10" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} placeholder="0" />
                </label>
                <label className="text-xs text-muted">
                  {rateLabel} (₹)
                  <Input className="h-10" inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} placeholder="0" />
                </label>
              </div>
              {it && (Number(l.qty) > 0) && (
                <p className="mt-1.5 text-xs text-muted">
                  Base <span className="num">{formatINR(basePaise(l))}</span>
                  {Number(it.gst_rate) > 0 && <> · GST {it.gst_rate}% <span className="num">{formatINR(gstPaise(l))}</span></>}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <button type="button" onClick={add} className="flex items-center gap-1.5 text-sm font-medium text-brand-600">
        <Plus size={16} /> Add item
      </button>

      <div className="flex justify-between border-t border-line pt-2 text-sm">
        <span className="text-muted">Subtotal · GST · Total</span>
        <span className="num font-medium">
          {formatINR(subtotal, false)} · {formatINR(gst, false)} · {formatINR(subtotal + gst)}
        </span>
      </div>
    </div>
  )
}
