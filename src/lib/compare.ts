export type Verdict = 'agree' | 'differ' | 'blank'

/**
 * Puts an answer into a plain form so that answers which mean the same thing compare equal.
 *
 *   "x = 5"      -> 5        a leading "x =" label is dropped when a plain value follows
 *   "3/4"        -> 0.75     fractions, mixed numbers and decimals all become numbers
 *   "x = 1 1/2"  -> 1.5
 *   "−3"         -> -3       typographic minus signs count as minus
 *   "45°"        -> 45       a trailing degree or percent sign is ignored
 *   "(B)"        -> "b"      multiple-choice letters lose case and brackets
 *   " Y=2X+1 "   -> "y=2x+1" anything else is compared as text, ignoring case and spaces...
 *   "10 000"     -> 10000    spaces grouping thousands, the Canadian way, are read as a number
 *   "3 4"        -> "3_4"    ...but any other space between two digits is kept: not 34
 *
 * Returns null for an empty answer.
 */
export function normalize(raw: string): number | string | null {
  let s = raw.trim().toLowerCase().replace(/[−–—]/g, '-')
  if (s === '') return null

  // Order matters from here on: spaces are still in place, so "1 1/2" can be read as a mixed
  // number rather than collapsing into "11/2".
  s = s.replace(/\s*[°%]$/, '')
  if (s === '') return null

  const labelled = s.match(/^[a-z]\s*=\s*(.+)$/)
  if (labelled && toNumber(labelled[1]) !== null) s = labelled[1]

  const value = toNumber(s)
  if (value !== null) return value

  const choice = s.match(/^\(\s*([a-z])\s*\)$/)
  if (choice) return choice[1]

  return s.replace(/(\d)\s+(?=\d)/g, '$1_').replace(/\s+/g, '')
}

function toNumber(raw: string): number | null {
  const s = raw.trim()

  const mixed = s.match(/^(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (mixed) {
    const [, sign, whole, num, den] = mixed
    if (Number(den) === 0) return null
    const value = Number(whole) + Number(num) / Number(den)
    return sign === '-' ? -value : value
  }

  if (/^-?\d{1,3}( \d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/ /g, ''))

  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s)

  const fraction = s.match(/^(-?\d+)\s*\/\s*(-?\d+)$/)
  if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2])

  return null
}

const labelOf = (raw: string) => raw.trim().toLowerCase().match(/^([a-z])\s*=/)?.[1] ?? null

export function compareAnswers(mine: string, theirs: string): Verdict {
  const a = normalize(mine)
  const b = normalize(theirs)
  if (a === null || b === null) return 'blank'
  if (typeof a === 'number' && typeof b === 'number') {
    // "x = 3" and "y = 3" are different answers. Only a missing label is forgiven.
    const labelA = labelOf(mine)
    const labelB = labelOf(theirs)
    if (labelA && labelB && labelA !== labelB) return 'differ'
    // Only the rounding noise of one addition and one division is forgiven (1 1/3 against
    // 4/3), never a real difference, however small or large the numbers are.
    return Math.abs(a - b) <= 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b))
      ? 'agree'
      : 'differ'
  }
  return String(a) === String(b) ? 'agree' : 'differ'
}

export function compareSets(mine: string[], theirs: string[]): Verdict[] {
  // Walk the longer list: a question only one of you answered is blank, not missing.
  return Array.from({ length: Math.max(mine.length, theirs.length) }, (_, i) =>
    compareAnswers(mine[i] ?? '', theirs[i] ?? ''),
  )
}
