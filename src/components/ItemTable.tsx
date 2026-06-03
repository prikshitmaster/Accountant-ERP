import { Trash2, Plus } from 'lucide-react'
import type { Item } from '@/hooks/queries'
import { formatINR, rupeesToPaise } from '@/lib/money'

export type Line = { stock_item_id: string; qty: string; rate: string }
export const emptyLine = (): Line => ({ stock_item_id: '', qty: '', rate: '' })

const basePaise = (l: Line) =>
  Math.round(Number(l.qty || 0) * rupeesToPaise(l.rate || '0'))

const gstPaise = (l: Line, items: Item[]) => {
  const it = items.find((i) => i.id === l.stock_item_id)
  return it ? Math.round((basePaise(l) * Number(it.gst_rate)) / 100) : 0
}

export function ItemTable({
  items,
  value,
  onChange,
}: {
  items: Item[]
  value: Line[]
  onChange: (lines: Line[]) => void
}) {
  const set = (i: number, patch: Partial<Line>) =>
    onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const add = () => onChange([...value, emptyLine()])
  const remove = (i: number) => {
    if (value.length === 1) return
    onChange(value.filter((_, idx) => idx !== i))
  }

  const subtotal = value.reduce((s, l) => s + basePaise(l), 0)
  const gst      = value.reduce((s, l) => s + gstPaise(l, items), 0)

  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-8">#</th>
            <th>Product</th>
            <th className="w-20">Unit</th>
            <th className="r w-24">Qty</th>
            <th className="r w-28">Rate (₹)</th>
            <th className="r w-28">Amount</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {value.map((l, i) => {
            const it = items.find((x) => x.id === l.stock_item_id)
            const amt = basePaise(l)
            return (
              <tr key={i}>
                <td className="num text-muted">{i + 1}</td>
                <td>
                  <select
                    className="w-full bg-transparent text-sm outline-none"
                    value={l.stock_item_id}
                    onChange={(e) => {
                      const picked = items.find((x) => x.id === e.target.value)
                      const prefill = !l.rate && picked?.sale_price ? String(picked.sale_price / 100) : l.rate
                      set(i, { stock_item_id: e.target.value, rate: prefill || '' })
                    }}
                  >
                    <option value="" disabled>Select item…</option>
                    {items.map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                  </select>
                </td>
                <td className="text-muted text-sm">{it?.unit ?? '—'}</td>
                <td className="r">
                  <input
                    className="w-full bg-transparent text-right text-sm num outline-none"
                    inputMode="decimal"
                    value={l.qty}
                    placeholder="0"
                    onChange={(e) => set(i, { qty: e.target.value })}
                  />
                </td>
                <td className="r">
                  <input
                    className="w-full bg-transparent text-right text-sm num outline-none"
                    inputMode="decimal"
                    value={l.rate}
                    placeholder="0.00"
                    onChange={(e) => set(i, { rate: e.target.value })}
                  />
                </td>
                <td className="r num text-sm">{amt > 0 ? formatINR(amt, false) : '—'}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={value.length === 1}
                    className="text-muted hover:text-neg disabled:opacity-20"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
          <tr>
            <td colSpan={7}>
              <button
                type="button"
                onClick={add}
                className="flex items-center gap-1 text-sm font-medium text-brand-600"
              >
                <Plus size={14} /> Add item
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="r text-sm text-muted pt-2">Subtotal</td>
            <td className="r num text-sm pt-2">{formatINR(subtotal, false)}</td>
            <td />
          </tr>
          {gst > 0 && (
            <tr>
              <td colSpan={5} className="r text-sm text-muted">GST</td>
              <td className="r num text-sm">{formatINR(gst, false)}</td>
              <td />
            </tr>
          )}
          <tr>
            <td colSpan={5} className="r text-sm font-semibold">Total</td>
            <td className="r num text-sm font-semibold">{formatINR(subtotal + gst)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
