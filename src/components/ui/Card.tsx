import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-2xl border border-line bg-white p-4 shadow-sm', className)}>
      {children}
    </div>
  )
}
