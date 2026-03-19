import { Loader2 } from 'lucide-react';

const sizeClasses = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  xl: 'w-6 h-6',
  '2xl': 'w-8 h-8',
} as const;

interface LoadingSpinnerProps {
  size?: keyof typeof sizeClasses;
  label?: string;
  className?: string;
}

export function LoadingSpinner({ size = 'md', label, className }: LoadingSpinnerProps) {
  const spinner = (
    <Loader2
      aria-hidden="true"
      className={`${sizeClasses[size]} animate-spin ${className ?? ''}`}
    />
  );

  if (label) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5">
        {spinner}
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return spinner;
}
