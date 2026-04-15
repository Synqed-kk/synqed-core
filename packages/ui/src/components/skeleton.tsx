import { cn } from '../utils/cn.js'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-[var(--radius-md)] bg-[var(--color-bg-muted)]',
        className,
      )}
      {...props}
    />
  )
}
