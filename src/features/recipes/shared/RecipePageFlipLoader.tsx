import { useTranslation } from '@/i18n/useTranslation';

/**
 * Branded recipe loading animation -- a small book icon with flipping pages.
 * Replaces generic Loader2 spinners during recipe execution moments.
 */
export function RecipePageFlipLoader({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      className={`w-[20px] h-[20px] ${className}`}
      aria-label={t.shared.suspense_loading}
    >
      <style>{`
        @keyframes pageFlip1 {
          0%, 100% { transform: rotateY(0deg); opacity: 1; }
          25% { transform: rotateY(-160deg); opacity: 0.3; }
          50%, 75% { transform: rotateY(-180deg); opacity: 0; }
        }
        @keyframes pageFlip2 {
          0%, 25%, 100% { transform: rotateY(0deg); opacity: 1; }
          50% { transform: rotateY(-160deg); opacity: 0.3; }
          75% { transform: rotateY(-180deg); opacity: 0; }
        }
        @keyframes pageFlip3 {
          0%, 50%, 100% { transform: rotateY(0deg); opacity: 1; }
          75% { transform: rotateY(-160deg); opacity: 0.3; }
        }
        .page1 { animation: pageFlip1 1.2s ease-in-out infinite; transform-origin: left center; }
        .page2 { animation: pageFlip2 1.2s ease-in-out infinite; transform-origin: left center; }
        .page3 { animation: pageFlip3 1.2s ease-in-out infinite; transform-origin: left center; }
      `}</style>

      {/* Book spine */}
      <rect x="2" y="3" width="2" height="14" rx="1" fill="currentColor" opacity="0.6" />

      {/* Book cover (back) */}
      <rect x="4" y="3" width="13" height="14" rx="1.5" fill="currentColor" opacity="0.15" />

      {/* Page 3 (innermost) */}
      <rect className="page3" x="5" y="4.5" width="11" height="11" rx="1" fill="currentColor" opacity="0.25" />

      {/* Page 2 */}
      <rect className="page2" x="5" y="4.5" width="11" height="11" rx="1" fill="currentColor" opacity="0.4" />

      {/* Page 1 (topmost) */}
      <rect className="page1" x="5" y="4.5" width="11" height="11" rx="1" fill="currentColor" opacity="0.6" />

      {/* Text lines on visible page */}
      <rect x="7" y="7" width="7" height="1" rx="0.5" fill="currentColor" opacity="0.2" />
      <rect x="7" y="9.5" width="5" height="1" rx="0.5" fill="currentColor" opacity="0.15" />
      <rect x="7" y="12" width="6" height="1" rx="0.5" fill="currentColor" opacity="0.1" />
    </svg>
  );
}
