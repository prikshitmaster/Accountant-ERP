import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { cn } from '@/lib/cn'

type Tone = 'ink' | 'pos' | 'neg' | 'brand'

const valueTone: Record<Tone, string> = {
  ink: 'text-ink',
  pos: 'text-pos',
  neg: 'text-neg',
  brand: 'text-brand-600',
}
const iconWrap: Record<Tone, string> = {
  ink: 'bg-canvas text-muted',
  pos: 'bg-[#ecfdf5] text-pos',
  neg: 'bg-[#fff1f2] text-neg',
  brand: 'bg-brand-50 text-brand-600',
}

/**
 * A headline metric, stated plainly: a clear label, one big number, and an
 * optional sub-line ("3 invoices", "since yesterday"). Icon + colour make the
 * meaning legible at a glance.
 */
export function StatCard({
  label, value, sub, icon: Icon, tone = 'ink',
}: {
  label: string
  value: ReactNode
  sub?: string
  icon?: ComponentType<LucideProps>
  tone?: Tone
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 card-elev">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        {Icon && (
          <span className={cn('grid h-9 w-9 place-items-center rounded-xl', iconWrap[tone])}>
            <Icon size={18} />
          </span>
        )}
      </div>
      <p className={cn('num mt-2 text-2xl font-bold tracking-tight', valueTone[tone])}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  )
}
