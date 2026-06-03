import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Item } from '@/hooks/queries'

export function ItemCombobox({
  items,
  value,
  onChange,
}: {
  items: Item[]
  value: string
  onChange: (id: string, item: Item | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = items.find((i) => i.id === value) ?? null

  const filtered = query
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
    : items

  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlighted(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (item: Item) => {
    onChange(item.id, item)
    setOpen(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { setHighlighted((h) => Math.min(h + 1, filtered.length - 1)); e.preventDefault(); return }
    if (e.key === 'ArrowUp')   { setHighlighted((h) => Math.max(h - 1, 0)); e.preventDefault(); return }
    if (e.key === 'Enter' && filtered[highlighted]) { select(filtered[highlighted]); e.preventDefault() }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {open ? (
        <input
          ref={inputRef}
          className="w-full bg-transparent text-sm outline-none border-b border-brand-400 pb-0.5"
          placeholder="Search…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHighlighted(0) }}
          onKeyDown={handleKey}
        />
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm"
          onClick={() => setOpen(true)}
        >
          <span className={selected ? 'text-ink' : 'text-muted'}>
            {selected ? selected.name : 'Select item…'}
          </span>
          <ChevronDown size={14} className="text-muted shrink-0" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-line bg-white shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No items found</p>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-paper ${i === highlighted ? 'bg-paper' : ''}`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => select(item)}
              >
                <span>{item.name}</span>
                <span className="text-xs text-muted ml-2 shrink-0">{item.unit}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
