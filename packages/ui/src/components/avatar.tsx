import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../utils/cn.js'

const sizeMap = {
  sm: 'w-8 h-8 text-xs rounded-[var(--radius-sm)]',
  md: 'w-10 h-10 text-sm rounded-[var(--radius-md)]',
  lg: 'w-12 h-12 text-base rounded-[var(--radius-lg)]',
  xl: 'w-16 h-16 text-xl rounded-[var(--radius-xl)]',
} as const

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  initials: string
  size?: keyof typeof sizeMap
  color?: string
}

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ initials, size = 'md', color, className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center font-semibold text-[var(--color-text-inverse)] shrink-0',
        sizeMap[size],
        className,
      )}
      style={{ background: color || 'var(--color-accent)', ...style }}
      {...props}
    >
      {initials}
    </div>
  ),
)
Avatar.displayName = 'Avatar'
