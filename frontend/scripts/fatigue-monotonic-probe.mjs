import { FATIGUE_MODEL, FATIGUE_SCAN_MS, fatigueOf } from '../src/lib/recovery.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const BASE = Date.UTC(2026, 0, 31, 12)
const ID = '1254'

const workout = (start, weight, count = 8, rir) => ({
  d: new Date(start).toISOString(),
  start,
  entries: [{
    id: ID,
    sets: Array.from({ length: count }, () => (rir === undefined
      ? { done: true, w: weight, r: 8 }
      : { done: true, w: weight, r: 8, rir })),
  }],
})

// History-edit scope. With an estimated RIR, deleting an earlier session can lower the e1RM a
// later session is compared against. The same load then looks closer to failure, so that later
// session's estimated RIR drops and its stimulus and fatigue go UP. Deletion monotonicity
// therefore only holds for (a) sets with a manual RIR, whose stimulus never reads other
// sessions, and (b) workouts older than the scan plus the e1RM window (30 + 60 = 90 days),
// which no scanned session can read at all.
const HISTORY_REACH_MS = FATIGUE_SCAN_MS + FATIGUE_MODEL.E1RM_WINDOW_MS

// Deterministic LCG: failures reproduce exactly without an external property-testing dependency.
let seed = 0x5eed1234
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}

let comparisons = 0
let deletionComparisons = 0
let largestIncrease = -Infinity
for (let historyIndex = 0; historyIndex < 100; historyIndex += 1) {
  const sessionCount = 3 + Math.floor(random() * 10)
  const history = Array.from({ length: sessionCount }, () => {
    const ageHours = Math.floor(random() * 120 * 24)
    const weight = 40 + Math.floor(random() * 141)
    const count = 1 + Math.floor(random() * 12)
    return workout(BASE - ageHours * HOUR, weight, count)
  })

  let previous = fatigueOf(history, BASE).chest
  for (let hour = 1; hour <= 1080; hour += 1) {
    const current = fatigueOf(history, BASE + hour * HOUR).chest
    const increase = current - previous
    largestIncrease = Math.max(largestIncrease, increase)
    if (increase > 1e-12) {
      throw new Error(
        `fatigue increased in history ${historyIndex} at hour ${hour}: ${previous} -> ${current}`,
      )
    }
    previous = current
    comparisons += 1
  }

  // (a) The same random history, with every set carrying a manual RIR.
  const rated = history.map(item => workout(item.start, item.entries[0].sets[0].w,
    item.entries[0].sets.length, Math.floor(random() * 9) / 2))
  const beforeDeletion = fatigueOf(rated, BASE)
  for (let deleted = 0; deleted < rated.length; deleted += 1) {
    const afterDeletion = fatigueOf(rated.filter((_, index) => index !== deleted), BASE)
    for (const [slug, before] of Object.entries(beforeDeletion)) {
      if (afterDeletion[slug] > before + Number.EPSILON) {
        throw new Error(
          `deleting rated workout ${deleted} in history ${historyIndex} increased ${slug}: `
          + `${before} -> ${afterDeletion[slug]}`,
        )
      }
      deletionComparisons += 1
    }
  }
}

if (comparisons !== 108000) throw new Error(`expected 108000 comparisons, got ${comparisons}`)

// (b) Workouts older than the scan plus the e1RM window never change current fatigue, whether
// they carry an estimated or a manual RIR.
if (HISTORY_REACH_MS !== 90 * DAY) throw new Error(`expected a 90-day reach, got ${HISTORY_REACH_MS / DAY}`)
const today = workout(BASE, 100, 5)
const baseline = fatigueOf([today], BASE)
let outOfWindowComparisons = 0
for (const oldImport of [
  workout(BASE - HISTORY_REACH_MS, 140, 10),
  workout(BASE - HISTORY_REACH_MS - DAY, 60, 20),
  workout(BASE - 120 * DAY, 100, 20, 0),
]) {
  const withImport = fatigueOf([oldImport, today], BASE)
  for (const [slug, value] of Object.entries(baseline)) {
    if (withImport[slug] !== value) throw new Error(`an import older than 90 days changed ${slug}`)
    outOfWindowComparisons += 1
  }
}
// Guard against a vacuous pass: a heavier import inside the window does change the estimate.
if (fatigueOf([workout(BASE - 45 * DAY, 140, 10), today], BASE).chest === baseline.chest) {
  throw new Error('an in-window import did not reach the e1RM estimate')
}

console.log(`monotonic probe: ${comparisons} comparisons, largest increase ${largestIncrease}, PASS`)
console.log(
  `history-edit probe: ${deletionComparisons} manual-RIR single-workout deletion comparisons `
  + `non-increasing; ${outOfWindowComparisons} out-of-window (>90 d) import comparisons stable, PASS`,
)
