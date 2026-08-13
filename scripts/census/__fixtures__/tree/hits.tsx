/**
 * Census self-test fixture. EVERY count in this file is asserted exactly by
 * `scripts/census/self-test.mjs`. If you edit it without updating those
 * assertions the self-test fails — which is the entire point: it is what proves
 * the runner still detects what it claims to detect.
 *
 * This block mentions localStorage and animate-spin and <select deliberately:
 * comment-only lines must NOT be counted as violations. Prose about a migration
 * is not a violation of it.
 */

export function StorageFixture() {
  const raw = localStorage.getItem('census-fixture');
  const other = window.sessionStorage.getItem('census-fixture');
  localStorage.setItem('census-fixture', '1');
  return raw ?? other;
}

export function SpinnerFixture({ busy }: { busy: boolean }) {
  return (
    <div className="flex animate-spin" data-busy={busy}>
      <span className="h-3 w-3 animate-spin rounded-full" />
    </div>
  );
}

export function SelectFixture() {
  return (
    <>
      <select className="w-full" name="mid-line" />
      <select
        name="token-at-end-of-line"
      />
      <selectFoo />
      <ThemedSelect name="not-a-raw-one" />
    </>
  );
}
