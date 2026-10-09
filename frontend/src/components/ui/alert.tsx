import type { ReactNode } from 'react';

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

interface AlertProps {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<AlertVariant, string> = {
  info: 'bg-primary/10 text-primary-dark border-primary/30',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-secondary/10 text-secondary border-secondary/30',
  error: 'bg-error/10 text-error border-error/30',
};

export function Alert({ variant = 'info', children, className = '' }: AlertProps) {
  return (
    <div role="alert" className={`rounded-lg border p-4 text-sm ${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  );
}
