import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useItems, useStockLedger, useInventoryRecon } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'

export function StockPage() {
  const { currentOrgId } = useAuth()
  const { data: items = [] } = useItems(currentOrgId)
  const { data: recon } = useInventoryRecon(currentOrgId)
  const [item, setItem] = useState('')
  useEffect(() => { if (!item && items.length) setItem(items[0].id) }, [items, item])
  const { data: ledger = [] } = useStockLedger(currentOrgId, item || null)

  const totalValue = items.reduce((s, i) => s + i.value_on_hand, 0)
  const matched = recon ? Number(recon.ledger_balance) === Number(recon.stock_value) : true

  return (
    <div className="space-y-5">
      <PageHeader title="Stock" description="See what you have on hand and confirm your books match your inventory." />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><p className="text-xs text-muted">Total stock value</p><p className="num mt-1 text-lg font-semibold">{formatINR(totalValue)}</p></Card>
        <Card><p className="text-xs text-muted">Inventory ledger (GL)</p><p className="num mt-1 text-lg font-semibold">{formatINR(recon?.ledger_balance ?? 0)}</p></Card>
        <Card className={matched ? '' : 'border-neg'}>
          <p className="text-xs text-muted">Reconciliation</p>
          <p className={`mt-1 text-lg font-semibold ${matched ? 'text-pos' : 'text-neg'}`}>{matched ? 'Matched ✓' : 'Mismatch!'}</p>
        </Card>
      </div>

      <Card className="p-0">
        <div className="border-b border-line p-4">
          <Select className="max-w-xs" value={item} onChange={(e) => setItem(e.target.value)}>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Voucher</th><th className="r">In/Out</th><th className="r">Rate</th><th className="r">Balance qty</th><th className="r">Balance value</th></tr>
            </thead>
            <tbody>
              {ledger.map((r, i) => (
                <tr key={i}>
                  <td className="num">{formatDate(r.date)}</td>
                  <td className="num">{r.voucher_no ?? r.reason}</td>
                  <td className={`r num ${r.qty_change < 0 ? 'text-neg' : 'text-pos'}`}>{r.qty_change > 0 ? '+' : ''}{r.qty_change}</td>
                  <td className="r num">{formatINR(r.unit_cost, false)}</td>
                  <td className="r num">{r.balance_qty}</td>
                  <td className="r num">{formatINR(r.balance_value, false)}</td>
                </tr>
              ))}
              {!ledger.length && <tr><td colSpan={6} className="py-6 text-center text-muted">No movements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
