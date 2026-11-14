import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-xl border border-border-default bg-bg-elevated p-6 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: CardProps) {
  return <div className={`mb-4 ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = '' }: CardProps) {
  return <h2 className={`text-lg font-semibold text-text-primary ${className}`}>{children}</h2>;
}

export function CardDescription({ children, className = '' }: CardProps) {
  return <p className={`text-sm text-text-secondary ${className}`}>{children}</p>;
}
