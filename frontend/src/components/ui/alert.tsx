import type { ReactNode } from 'react';

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

interface AlertProps {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<AlertVariant, string> = {
  info: 'bg-primary-muted text-violet-400 border-border-accent',
  success: 'bg-success-muted text-success border-success/20',
  warning: 'bg-warning-muted text-warning border-warning/20',
  error: 'bg-error-muted text-error border-error/20',
};

export function Alert({ variant = 'info', children, className = '' }: AlertProps) {
  return (
    <div role="alert" className={`rounded-lg border p-4 text-sm ${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  );
}
