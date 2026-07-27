# Sample peak per-process memory during a cargo build.
#
# Mirrors the 2026-07-26 methodology that produced the 8.9 GB figure: poll every
# second, track peak WorkingSet64 per process NAME and the peak of the summed
# total, and separately record the single largest rustc — because the thing that
# can OOM the machine is one process, not the sum.
#
#   powershell -File scripts/build/sample-build-memory.ps1 -OutFile peak.json
#   cargo test --features desktop --lib --no-run     # in another shell
#   touch build-memory.stop                          # then read peak.json
#
# Start it, run the build, then stop it (it exits when -StopFile appears).
#
# MEASURED RESULTS on this repo, `cargo test --features desktop --lib --no-run`
# after `cargo clean -p` on the four workspace crates:
#
#   2026-07-26  one 431k-LOC app_lib                    8,872 MB single rustc
#   2026-07-27  after the crate split, same debuginfo   6,201 MB single rustc
#   2026-07-27  after the split, committed debug=0      5,933 MB single rustc
#
# The middle row is the honest comparison: it holds debuginfo at the baseline's
# `line-tables-only` so the delta is the split alone (-30%). `[profile.test]
# debug = 0` is worth a further ~3%, much less than assumed.
#
# `peak_single_rustc_mb` is the number that matters — one process is what OOMs a
# machine. It still tracks the LARGEST crate, so further reduction means
# shrinking app_lib, not adding more small crates.
param(
    [string]$OutFile  = "build-memory.json",
    [string]$StopFile = "build-memory.stop",
    [int]$IntervalMs  = 1000
)

$names = @('rustc', 'cargo', 'link', 'lld-link', 'rust-lld')
$peakByName   = @{}
$peakSingle   = @{}   # largest SINGLE process of that name, ever
$peakTotal    = 0
$samples      = 0
$start        = Get-Date

while (-not (Test-Path $StopFile)) {
    $total = 0
    foreach ($n in $names) {
        $procs = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
        if ($procs.Count -eq 0) { continue }
        $sum = ($procs | Measure-Object -Property WorkingSet64 -Sum).Sum
        $max = ($procs | Measure-Object -Property WorkingSet64 -Maximum).Maximum
        $total += $sum
        if (-not $peakByName.ContainsKey($n) -or $sum -gt $peakByName[$n]) { $peakByName[$n] = $sum }
        if (-not $peakSingle.ContainsKey($n) -or $max -gt $peakSingle[$n]) { $peakSingle[$n] = $max }
    }
    if ($total -gt $peakTotal) { $peakTotal = $total }
    $samples++
    Start-Sleep -Milliseconds $IntervalMs
}

$mb = { param($b) [math]::Round($b / 1MB, 0) }
$result = [ordered]@{
    peak_total_mb      = & $mb $peakTotal
    peak_single_rustc_mb = if ($peakSingle.ContainsKey('rustc')) { & $mb $peakSingle['rustc'] } else { 0 }
    peak_all_rustc_mb  = if ($peakByName.ContainsKey('rustc'))   { & $mb $peakByName['rustc'] }   else { 0 }
    peak_cargo_mb      = if ($peakByName.ContainsKey('cargo'))   { & $mb $peakByName['cargo'] }   else { 0 }
    peak_linker_mb     = (@('link','lld-link','rust-lld') | ForEach-Object { if ($peakByName.ContainsKey($_)) { & $mb $peakByName[$_] } else { 0 } } | Measure-Object -Maximum).Maximum
    samples            = $samples
    duration_s         = [math]::Round(((Get-Date) - $start).TotalSeconds, 0)
}
$result | ConvertTo-Json | Out-File -FilePath $OutFile -Encoding utf8
