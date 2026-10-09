interface SpinnerProps {
  className?: string;
}

export function Spinner({ className = 'h-8 w-8' }: SpinnerProps) {
  return (
    <div className="flex items-center justify-center p-8" role="status" aria-label="Carregando">
      <svg
        className={`animate-spin text-primary ${className}`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="sr-only">Carregando...</span>
    </div>
  );
}
