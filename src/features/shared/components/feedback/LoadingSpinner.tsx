const sizeClasses = {
  xs: '',
  sm: '',
  md: '',
  lg: '',
  xl: '',
  '2xl': '',
} as const;

interface LoadingSpinnerProps {
  size?: keyof typeof sizeClasses;
  label?: string;
  className?: string;
}

// Spinners are intentionally disabled app-wide. The component stays for import
// compatibility but renders nothing; a screen-reader-only label is preserved
// when callers provide one so assistive tech still hears loading state.
export function LoadingSpinner({ label }: LoadingSpinnerProps) {
  if (label) {
    return (
      <span role="status" className="sr-only">
        {label}
      </span>
    );
  }
  return null;
}
