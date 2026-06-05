import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useParties } from '@/hooks/queries'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/cn'
import { PartyDetailPanel } from './PartyDetailPanel'
import { PartyFormDrawer } from './PartyFormDrawer'

export function PartiesPage() {
  const { currentOrgId } = useAuth()
  const { id: selectedId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const nav = useNavigate()

  const kindParam = searchParams.get('kind') as 'customer' | 'supplier' | undefined
  const { data: parties = [] } = useParties(currentOrgId, kindParam ?? undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const listTitle = kindParam === 'customer'
    ? 'All Customers'
    : kindParam === 'supplier'
      ? 'All Vendors'
      : 'All Parties'

  const selected = parties.find((p) => p.id === selectedId)

  function selectParty(id: string) {
    const qs = kindParam ? `?kind=${kindParam}` : ''
    nav(`/parties/${id}${qs}`)
  }

  function closeDetail() {
    const qs = kindParam ? `?kind=${kindParam}` : ''
    nav(`/parties${qs}`)
  }

  return (
    <div className={cn(
      'flex overflow-hidden rounded-xl border border-line bg-surface',
      // On the detail page (selectedId exists) the main has max-w-5xl which is fine.
      // We just need the split to fill the available height.
      selectedId ? 'h-[calc(100vh-7rem)]' : 'min-h-[60vh]',
    )}>
      {/* ── Left: party list ── */}
      <div className={cn(
        'flex flex-col border-r border-line',
        selectedId ? 'hidden w-72 shrink-0 md:flex' : 'flex w-full md:w-72 md:shrink-0',
      )}>
        {/* List header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">{listTitle}</span>
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Party rows */}
        <div className="flex-1 overflow-y-auto">
          {parties.length === 0 && (
            <p className="p-4 text-sm text-muted">No parties yet. Add one with +</p>
          )}
          {parties.map((p) => {
            const isSelected = p.id === selectedId
            return (
              <button
                key={p.id}
                onClick={() => selectParty(p.id)}
                className={cn(
                  'flex w-full items-start justify-between gap-2 border-b border-line px-4 py-3 text-left transition-colors',
                  isSelected
                    ? 'bg-brand-600 text-white'
                    : 'hover:bg-canvas',
                )}
              >
                <div className="min-w-0">
                  <p className={cn('truncate text-sm font-medium', isSelected ? 'text-white' : 'text-ink')}>
                    {p.name}
                  </p>
                  {p.group_name && (
                    <p className={cn('text-xs', isSelected ? 'text-white/70' : 'text-muted')}>
                      {p.group_name}
                    </p>
                  )}
                </div>
                <span className={cn(
                  'shrink-0 text-right text-xs num',
                  isSelected ? 'text-white/90' : p.balance > 0 ? 'text-pos' : p.balance < 0 ? 'text-neg' : 'text-muted',
                )}>
                  {formatINR(Math.abs(p.balance))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Right: detail panel ── */}
      <div className={cn(
        'flex-1 overflow-hidden',
        !selectedId && 'hidden md:flex md:flex-col',
      )}>
        {selected ? (
          <PartyDetailPanel
            key={selected.id}
            partyId={selected.id}
            partyName={selected.name}
            balance={selected.balance}
            kind={selected.kind}
            onClose={closeDetail}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <p className="text-sm">Select a party to view details</p>
          </div>
        )}
      </div>

      {/* Mobile: back button when detail is open */}
      {selectedId && (
        <div className="fixed bottom-4 left-4 z-30 md:hidden">
          <button
            onClick={closeDetail}
            className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            ← Back to list
          </button>
        </div>
      )}

      {/* New party drawer */}
      <PartyFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        defaultKind={kindParam ?? 'customer'}
      />
    </div>
  )
}
