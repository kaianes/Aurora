import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-violet-500 text-white hover:bg-violet-600 focus:ring-violet-500/40 shadow-[0_0_20px_rgba(139,92,246,0.2)] hover:shadow-[0_0_24px_rgba(139,92,246,0.35)]',
  secondary:
    'bg-primary-muted text-primary hover:bg-[rgba(167,139,250,0.2)] focus:ring-violet-500/30',
  outline:
    'border border-border-default text-text-primary hover:bg-bg-hover hover:border-border-accent focus:ring-violet-500/30',
  ghost:
    'text-text-secondary hover:text-text-primary hover:bg-bg-hover focus:ring-violet-500/30',
  danger:
    'bg-error-muted text-error hover:bg-[rgba(248,113,113,0.2)] focus:ring-error/30',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, disabled, className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
