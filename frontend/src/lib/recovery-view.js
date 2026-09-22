import { FATIGUE_STATES } from './recovery.js'

/**
 * The single source of truth for every fatigue threshold in the app: the l0-l4 shade bands the
 * BodyMap paints and the consumer-facing state label share one ordered array, so a band and its
 * wording can never drift apart again.
 *
 * The shape is the `{ at, level, exclusive? }` contract `levelsOf` reads (last matching rule
 * wins); `levelsOf` ignores the extra `state` key, which the label selector below uses. Only
 * the top rule is exclusive, so a value landing exactly on 0.15, 0.25, 0.4 or 0.5 takes the
 * band it names, and only a value strictly above 0.5 reads as fatigued.
 */
export const FATIGUE_LEVELS = Object.freeze([
  Object.freeze({ at: 0, level: 0, state: FATIGUE_STATES.READY }),
  Object.freeze({ at: 0.15, level: 1, state: FATIGUE_STATES.READY }),
  Object.freeze({ at: 0.25, level: 2, state: FATIGUE_STATES.RECOVERING }),
  Object.freeze({ at: 0.4, level: 3, state: FATIGUE_STATES.RECOVERING }),
  Object.freeze({ at: 0.5, level: 4, state: FATIGUE_STATES.FATIGUED, exclusive: true }),
])

// The band one value falls into, applying exactly the rule levelsOf applies: walk the ordered
// rules and keep the last one that matches. Nothing below the first rule exists in practice
// (fatigue is never negative), so the l0 rule doubles as the default.
function fatigueRuleOf(value) {
  let matched = FATIGUE_LEVELS[0]
  for (const rule of FATIGUE_LEVELS) {
    if (rule.exclusive ? value > rule.at : value >= rule.at) matched = rule
  }
  return matched
}

/**
 * Select the consumer-facing fatigue state for one numeric recovery value.
 * Bands l0-l1 are ready, l2-l3 are recovering, and l4 is fatigued: values below .25 are ready,
 * .25 through .5 are recovering, and values above .5 are fatigued.
 * Keeping this boundary selector in production code prevents views and tests from drifting apart.
 *
 * @param {number} value Numeric fatigue value from fatigueOf().
 * @returns {'ready'|'recovering'|'fatigued'} The stable state label for the UI.
 */
export function fatigueStateOf(value) {
  return fatigueRuleOf(value).state
}
