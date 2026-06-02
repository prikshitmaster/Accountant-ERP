import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'pos' | 'neg' | 'warn' | 'muted' | 'brand'

const toneClass: Record<Tone, string> = {
  pos: 'badge-pos',
  neg: 'badge-neg',
  warn: 'badge-warn',
  muted: 'badge-muted',
  brand: 'badge-brand',
}

/** Small status pill (Paid / Due / Posted …) — colour carries meaning. */
export function Badge({ tone = 'muted', className, children }: {
  tone?: Tone
  className?: string
  children: ReactNode
}) {
  return <span className={cn('badge', toneClass[tone], className)}>{children}</span>
}
