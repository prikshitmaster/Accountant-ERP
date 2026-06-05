import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded font-medium transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700',
        secondary: 'bg-surface text-ink border border-[#d1d5db] hover:bg-canvas',
        ghost: 'text-brand-600 hover:bg-brand-50',
        danger: 'bg-neg text-white hover:opacity-90',
      },
      size: {
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
        sm: 'h-7 px-3 text-xs',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>

export function Button({ className, variant, size, ...props }: Props) {
  return <button className={cn(button({ variant, size }), className)} {...props} />
}
