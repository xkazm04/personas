"""render-acceptance detector, run as an EXPERIMENT against real Kokoro renders.

Implements the technique's signature exactly: bounded INTERNAL silence -- a
silent run past the bound, enclosed on BOTH sides by non-silent audio. Leading
and trailing silence are excluded by construction. Parameters are inputs with
stated defaults, not literals (technique: "claims about a particular engine,
sample rate and content mix").

Changes no product code. Reads WAVs produced by the same sidecar invocation
personas' kokoro.rs:220-247 builds.
"""
import sys, wave, struct

FRAME_MS = 20.0       # frame length
FLOOR_RATIO = 0.02    # energy floor as a fraction of the clip's peak RMS
GAP_MS = 700.0        # internal-silence bound (tuned below against real content)

def frames(path, frame_ms=FRAME_MS):
    w = wave.open(path, 'rb')
    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
    raw = w.readframes(n); w.close()
    s = struct.unpack('<%dh' % (len(raw)//2), raw)
    if ch == 2: s = s[::2]
    fl = max(1, int(sr*frame_ms/1000))
    out = []
    for i in range(0, len(s)-fl+1, fl):
        blk = s[i:i+fl]
        out.append((sum(x*x for x in blk)/fl) ** 0.5)
    return sr, len(s)/sr, out, fl/sr*1000

def detect(path, floor_ratio=FLOOR_RATIO, gap_ms=GAP_MS):
    sr, dur, rms, fms = frames(path)
    peak = max(rms) if rms else 0.0
    floor = peak * floor_ratio
    speech = [r > floor for r in rms]
    if not any(speech):
        return dur, None, 0.0
    first, last = speech.index(True), len(speech)-1-speech[::-1].index(True)
    worst, at = 0.0, None
    run = 0
    for i in range(first, last+1):
        if not speech[i]:
            run += 1
        else:
            if run*fms > worst: worst, at = run*fms, (i-run)*fms
            run = 0
    return dur, at, worst

for p in sys.argv[1:]:
    dur, at, worst = detect(p)
    v = "REJECT" if worst > GAP_MS else "accept"
    print(f"{p:34s} dur={dur:6.2f}s  longest_internal_gap={worst:7.1f}ms"
          f"  at={('%.2fs'%(at/1000)) if at is not None else '-':>7s}  -> {v}")
