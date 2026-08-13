// A file with zero violations of every fixture rule. Its job is to be walked
// and counted in `walked` while contributing nothing to `files` or `matches`,
// so the self-test can tell "the walk saw it" apart from "the rule matched it".

export function Clean() {
  return <div className="rounded-card p-4" data-fixture="clean" />;
}
