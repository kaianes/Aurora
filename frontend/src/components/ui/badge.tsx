import type { ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'primary';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-surface text-muted',
  success: 'bg-success/10 text-success',
  warning: 'bg-secondary/10 text-secondary',
  error: 'bg-error/10 text-error',
  primary: 'bg-primary/10 text-primary',
};

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
}
