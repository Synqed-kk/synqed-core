import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../utils/cn.js'

const variants = {
  default: 'bg-[var(--color-accent)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-hover)]',
  outline: 'border border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:bg-[var(--color-bg-card-hover)]',
  ghost: 'bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]',
  destructive: 'bg-[var(--color-destructive)] text-[var(--color-destructive-text)] hover:opacity-90',
  chrome: 'bg-[var(--color-chrome-hover)] text-[var(--color-chrome-text-active)] hover:bg-[var(--color-chrome-active)]',
} as const

const sizes = {
  sm: 'h-7 px-3 text-xs rounded-[var(--radius-sm)]',
  md: 'h-9 px-4 text-sm rounded-[var(--radius-md)]',
  lg: 'h-11 px-6 text-base rounded-[var(--radius-md)]',
  icon: 'h-9 w-9 rounded-[var(--radius-md)]',
  'icon-sm': 'h-7 w-7 rounded-[var(--radius-sm)]',
} as const

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
