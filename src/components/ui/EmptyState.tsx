import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'

/**
 * Friendly empty state: an icon, a plain explanation of what would appear here
 * and why it's empty, and an optional action to get started. Replaces bare
 * "No data" rows so a first-time user is never confused.
 */
export function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon?: ComponentType<LucideProps>
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-canvas text-muted">
          <Icon size={22} />
        </span>
      )}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
