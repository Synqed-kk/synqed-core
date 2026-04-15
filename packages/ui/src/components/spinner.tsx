import { forwardRef, type SVGAttributes } from 'react'
import { cn } from '../utils/cn.js'

const sizeMap = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' } as const

interface SpinnerProps extends SVGAttributes<SVGSVGElement> {
  size?: keyof typeof sizeMap
}

export const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(
  ({ size = 'md', className, ...props }, ref) => (
    <svg
      ref={ref}
      className={cn('animate-spin text-[var(--color-accent)]', sizeMap[size], className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      {...props}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  ),
)
Spinner.displayName = 'Spinner'
