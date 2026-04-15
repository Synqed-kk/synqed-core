import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../utils/cn.js'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-[var(--radius-xl)] p-5',
        'bg-[var(--color-bg-card)] border border-[var(--color-border)]',
        'transition-colors',
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mb-3', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-sm font-semibold uppercase tracking-widest text-[var(--color-text-muted)] font-mono', className)}
      {...props}
    />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardValue = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('text-3xl font-light tracking-tight text-[var(--color-text)]', className)}
      {...props}
    />
  ),
)
CardValue.displayName = 'CardValue'

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-xs text-[var(--color-text-muted)] mt-1', className)}
      {...props}
    />
  ),
)
CardDescription.displayName = 'CardDescription'
