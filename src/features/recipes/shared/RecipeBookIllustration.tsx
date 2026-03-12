export function RecipeBookIllustration({ className }: { className?: string }) {
  return (
    <img
      src="/illustrations/recipe-book.png"
      alt=""
      aria-hidden="true"
      className={className}
      width={120}
      height={120}
      style={{ objectFit: 'contain' }}
    />
  );
}
