import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../utils/cn.js'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-[var(--color-text)]"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-9 w-full px-3 text-sm',
            'rounded-[var(--radius-md)]',
            'bg-[var(--color-bg-card)] text-[var(--color-text)]',
            'border border-[var(--color-border)]',
            'placeholder:text-[var(--color-text-muted)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent',
            'disabled:opacity-50',
            'font-[inherit]',
            error && 'border-[var(--color-destructive)]',
            className,
          )}
          {...props}
        />
        {error && (
          <span className="text-xs text-[var(--color-destructive)]">{error}</span>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'
