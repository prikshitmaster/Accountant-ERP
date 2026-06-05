import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useItems, useStockLedger, useInventoryRecon } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { AlertTriangle, CheckCircle2, XCircle, Package, Search, ChevronLeft, ChevronRight } from 'lucide-react'

const LEDGER_PAGE = 20
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const shortDate = (iso: string) => { const [,m,d] = iso.split('T')[0].split('-'); return `${d} ${MONTHS[+m-1]}` }

const TYPE_META: Record<string, { label: string; cls: string }> = {
  PURCHASE:     { label: 'Purchase',    cls: 'bg-blue-100 text-blue-700' },
  SALE:         { label: 'Sale',        cls: 'bg-green-100 text-green-700' },
  CREDIT_NOTE:  { label: 'Return In',   cls: 'bg-orange-100 text-orange-700' },
  DEBIT_NOTE:   { label: 'Return Out',  cls: 'bg-orange-100 text-orange-700' },
  STOCK_JOURNAL:{ label: 'Manufacture', cls: 'bg-purple-100 text-purple-700' },
  JOURNAL:      { label: 'Journal',     cls: 'bg-gray-100 text-gray-600' },
  OPENING:      { label: 'Opening',     cls: 'bg-gray-100 text-gray-600' },
}

function TypeBadge({ code }: { code: string | null }) {
  const meta = code ? (TYPE_META[code] ?? { label: code, cls: 'bg-gray-100 text-gray-600' }) : { label: 'Adj', cls: 'bg-gray-100 text-gray-500' }
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
}

export function StockPage() {
  const { currentOrgId } = useAuth()
  const { data: items = [] } = useItems(currentOrgId)
  const { data: recon } = useInventoryRecon(currentOrgId)
  const [selectedId, setSelectedId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [ledgerPage, setLedgerPage] = useState(0)

  const selectItem = useCallback((id: string) => { setSelectedId(id); setLedgerPage(0) }, [])

  useEffect(() => { if (!selectedId && items.length) setSelectedId(items[0].id) }, [items, selectedId])

  const { data: ledger = [], isLoading: ledgerLoading } = useStockLedger(currentOrgId, selectedId || null)

  const totalValue = items.reduce((s, i) => s + i.value_on_hand, 0)
  const matched = recon ? Number(recon.ledger_balance) === Number(recon.stock_value) : true

  const filtered = useMemo(() =>
    items.filter(it => it.name.toLowerCase().includes(search.toLowerCase()) ||
      (it.item_code ?? '').toLowerCase().includes(search.toLowerCase())),
    [items, search])

  const selected = items.find(it => it.id === selectedId)

  const lowStockCount = items.filter(it => it.min_level > 0 && it.qty_on_hand <= it.min_level).length

  return (
    <div className="flex flex-col gap-5">
      {/* Summary row */}
      <div>
        <h1 className="text-xl font-semibold text-heading">Stock</h1>
        <p className="text-sm text-muted mt-0.5">Inventory positions and movement ledger</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-muted">Total Stock Value</p>
          <p className="num mt-1 text-lg font-semibold">{formatINR(totalValue)}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">GL Inventory Balance</p>
          <p className="num mt-1 text-lg font-semibold">{formatINR(recon?.ledger_balance ?? 0)}</p>
        </Card>
        <Card className={matched ? '' : 'border-neg'}>
          <p className="text-xs text-muted">Reconciliation</p>
          <div className="mt-1 flex items-center gap-1.5">
            {matched
              ? <><CheckCircle2 size={16} className="text-pos" /><span className="font-semibold text-pos">Matched</span></>
              : <><XCircle size={16} className="text-neg" /><span className="font-semibold text-neg">Mismatch</span></>}
          </div>
        </Card>
        <Card className={lowStockCount > 0 ? 'border-amber-300' : ''}>
          <p className="text-xs text-muted">Low Stock Items</p>
          <div className="mt-1 flex items-center gap-1.5">
            {lowStockCount > 0
              ? <><AlertTriangle size={16} className="text-amber-500" /><span className="font-semibold text-amber-600">{lowStockCount} item{lowStockCount > 1 ? 's' : ''}</span></>
              : <span className="font-semibold text-pos">All OK</span>}
          </div>
        </Card>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 min-h-0">
        {/* Item list sidebar */}
        <div className="w-64 shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full rounded border border-line bg-surface pl-8 pr-3 py-1.5 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex flex-col gap-1 overflow-y-auto">
            {filtered.map(it => {
              const isLow = it.min_level > 0 && it.qty_on_hand <= it.min_level
              const active = it.id === selectedId
              return (
                <button
                  key={it.id}
                  onClick={() => selectItem(it.id)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors
                    ${active ? 'border-brand bg-brand/5' : 'border-line bg-surface hover:border-brand/40 hover:bg-surface'}
                    ${isLow && !active ? 'border-amber-300' : ''}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className={`text-sm font-medium leading-tight ${active ? 'text-brand' : 'text-heading'}`}>{it.name}</span>
                    {isLow && <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />}
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="num text-xs text-muted">{Number(it.qty_on_hand).toLocaleString('en-IN')} {it.unit}</span>
                    <span className="num text-xs font-medium text-heading">{formatINR(it.value_on_hand, false)}</span>
                  </div>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-muted">No items found</div>
            )}
          </div>
        </div>

        {/* Item detail + ledger */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {selected ? (
            <>
              {/* Item header */}
              <Card className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Package size={16} className="text-muted" />
                      <h2 className="text-base font-semibold text-heading">{selected.name}</h2>
                      {selected.item_code && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-muted">{selected.item_code}</span>}
                      {selected.category && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-muted">{selected.category}</span>}
                      {selected.min_level > 0 && selected.qty_on_hand <= selected.min_level && (
                        <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                          <AlertTriangle size={10} />Low Stock
                        </span>
                      )}
                    </div>
                    {selected.description && <p className="mt-1 text-xs text-muted">{selected.description}</p>}
                  </div>
                  {selected.hsn && <span className="shrink-0 text-xs text-muted">HSN {selected.hsn} · {selected.gst_rate}% GST</span>}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  <div className="rounded bg-gray-50 p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted">Qty on Hand</p>
                    <p className="num mt-0.5 font-semibold text-heading">{Number(selected.qty_on_hand).toLocaleString('en-IN')} <span className="text-xs font-normal text-muted">{selected.unit}</span></p>
                  </div>
                  <div className="rounded bg-gray-50 p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted">Avg Cost</p>
                    <p className="num mt-0.5 font-semibold text-heading">{formatINR(selected.avg_cost, false)}</p>
                  </div>
                  <div className="rounded bg-gray-50 p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted">Stock Value</p>
                    <p className="num mt-0.5 font-semibold text-heading">{formatINR(selected.value_on_hand, false)}</p>
                  </div>
                  <div className={`rounded p-2 ${selected.min_level > 0 && selected.qty_on_hand <= selected.min_level ? 'bg-amber-50' : 'bg-gray-50'}`}>
                    <p className="text-[10px] uppercase tracking-wide text-muted">Min Level</p>
                    <p className={`num mt-0.5 font-semibold ${selected.min_level > 0 && selected.qty_on_hand <= selected.min_level ? 'text-amber-600' : 'text-heading'}`}>
                      {selected.min_level > 0 ? `${Number(selected.min_level).toLocaleString('en-IN')} ${selected.unit}` : '—'}
                    </p>
                  </div>
                  <div className="rounded bg-gray-50 p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted">Sale Price</p>
                    <p className="num mt-0.5 font-semibold text-heading">{formatINR(selected.sale_price, false)}</p>
                  </div>
                  <div className="rounded bg-gray-50 p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted">Purchase Price</p>
                    <p className="num mt-0.5 font-semibold text-heading">{formatINR(selected.purchase_price, false)}</p>
                  </div>
                </div>
              </Card>

              {/* Ledger table */}
              {(() => {
                const totalPages = Math.ceil(ledger.length / LEDGER_PAGE) || 1
                const paged = ledger.slice(ledgerPage * LEDGER_PAGE, (ledgerPage + 1) * LEDGER_PAGE)
                const last = ledger[ledger.length - 1]
                return (
                  <Card className="p-0">
                    <div className="border-b border-line px-4 py-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-heading">Stock Ledger</h3>
                      <span className="text-xs text-muted">{ledger.length} movement{ledger.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Voucher</th>
                            <th>Type</th>
                            <th className="r">In / Out</th>
                            <th className="r">Rate</th>
                            <th className="r">Bal Qty</th>
                            <th className="r">Bal Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerLoading && (
                            <tr><td colSpan={7} className="py-8 text-center text-sm text-muted">Loading…</td></tr>
                          )}
                          {!ledgerLoading && paged.map((r, i) => (
                            <tr key={ledgerPage * LEDGER_PAGE + i}>
                              <td className="num whitespace-nowrap">{shortDate(r.date)}</td>
                              <td className="num">{r.voucher_no ?? r.reason ?? '—'}</td>
                              <td><TypeBadge code={r.type_code} /></td>
                              <td className={`r num font-semibold ${r.qty_change < 0 ? 'text-neg' : 'text-pos'}`}>
                                {r.qty_change > 0 ? '+' : ''}{Number(r.qty_change).toLocaleString('en-IN')}
                              </td>
                              <td className="r num text-muted">{formatINR(r.unit_cost, false)}</td>
                              <td className="r num font-semibold">{Number(r.balance_qty).toLocaleString('en-IN')}</td>
                              <td className="r num font-semibold">{formatINR(r.balance_value, false)}</td>
                            </tr>
                          ))}
                          {!ledgerLoading && !ledger.length && (
                            <tr><td colSpan={7} className="py-10 text-center text-sm text-muted">No movements recorded yet.</td></tr>
                          )}
                        </tbody>
                        {last && (
                          <tfoot>
                            <tr className="bg-gray-50 font-semibold">
                              <td colSpan={3} className="text-muted">Closing balance</td>
                              <td className={`r num ${last.balance_qty < 0 ? 'text-neg' : ''}`}>
                                {Number(last.balance_qty).toLocaleString('en-IN')} {selected.unit}
                              </td>
                              <td />
                              <td className="r num">{Number(last.balance_qty).toLocaleString('en-IN')}</td>
                              <td className="r num">{formatINR(last.balance_value, false)}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
                        <span>{ledgerPage * LEDGER_PAGE + 1}–{Math.min((ledgerPage + 1) * LEDGER_PAGE, ledger.length)} of {ledger.length}</span>
                        <div className="flex items-center gap-1">
                          <button
                            disabled={ledgerPage === 0}
                            onClick={() => setLedgerPage(p => p - 1)}
                            className="flex items-center gap-0.5 rounded px-2 py-1 hover:bg-canvas disabled:opacity-30"
                          ><ChevronLeft size={13} /> Prev</button>
                          <span className="px-1">{ledgerPage + 1} / {totalPages}</span>
                          <button
                            disabled={ledgerPage >= totalPages - 1}
                            onClick={() => setLedgerPage(p => p + 1)}
                            className="flex items-center gap-0.5 rounded px-2 py-1 hover:bg-canvas disabled:opacity-30"
                          >Next <ChevronRight size={13} /></button>
                        </div>
                      </div>
                    )}
                  </Card>
                )
              })()}
            </>
          ) : (
            <Card className="flex flex-col items-center justify-center py-20 text-center">
              <Package size={40} className="text-muted mb-3" />
              <p className="text-sm text-muted">Select an item from the list to view its stock ledger.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
