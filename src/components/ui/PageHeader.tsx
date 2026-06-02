import type { ReactNode } from 'react'

/**
 * Every screen opens with a plain-language title + one-line explanation of
 * what the page is for, so a non-expert knows at a glance what they're looking
 * at. Optional `action` renders on the right (e.g. a primary button).
 */
export function PageHeader({
  title, description, action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
