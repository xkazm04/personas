#!/usr/bin/env node
// How many subagents may run RIGHT NOW. The driver calls this before every refill and launches
// min(width - running, queue depth) workers; it never launches on a hunch about the machine.
//   node width.mjs --running 7 [--max 10] [--per-worker-gb 2.5] [--reserve-gb 4]
// Prints one JSON line: { width, running, launch, why[] }. `launch` is how many MORE to start.
import os from 'node:os'
import { execSync } from 'node:child_process'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : Number(process.argv[i + 1]) }
const running = arg('running', 0)
const max = arg('max', 10)
const perWorkerGb = arg('per-worker-gb', 2.5)   // npm ci + vitest/tsc in a plain clone peaks well above the LLM process itself
const GB = 1024 ** 3
const totalGb = os.totalmem() / GB
const freeGb = os.freemem() / GB
const reserveGb = Math.max(arg('reserve-gb', 4), totalGb * 0.15)
const why = []

// Memory: a running worker has not finished growing, so it is charged twice (the pool's rule).
const ramNew = Math.max(0, Math.floor((freeGb - reserveGb - running * perWorkerGb) / perWorkerGb))
why.push(`free ${freeGb.toFixed(1)}/${totalGb.toFixed(1)} GB, reserve ${reserveGb.toFixed(1)} GB -> ram allows ${ramNew} more`)

// Hard brake: above 60% memory in use, start nothing new (running workers are left alone).
const usedPct = 100 * (1 - freeGb / totalGb)
const brake = usedPct > 60
if (brake) why.push(`memory ${usedPct.toFixed(0)}% > 60% -> no new workers`)

// CPU: about 60% of the logical cores (workers are mostly waiting on the model); compiles by sibling sessions take their share first.
let heavy = 0
try {
  const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', maxBuffer: 1 << 26 })
  heavy = (out.match(/^"(cargo|rustc|link|lld-link|cl)\.exe"/gim) || []).length
} catch { /* tasklist missing (non-Windows): no heavy-process signal, not an error */ }
const cores = os.cpus().length
const cpuWidth = Math.max(2, Math.floor(cores * 0.6) - Math.min(heavy, Math.floor(cores / 4)))
why.push(`${cores} cores, ${heavy} compiler processes -> cpu allows ${cpuWidth} total`)

const total = Math.min(max, cpuWidth, running + ramNew)
const width = brake ? running : Math.max(1, total)
const launch = brake ? 0 : Math.max(0, width - running)
console.log(JSON.stringify({ width, running, launch, why }))
