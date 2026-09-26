import { describe, expect, it } from 'vitest'
import { plainText } from './localAI'

// String.raw keeps the backslashes exactly as the model would write them.
describe('plainText', () => {
  it.each([
    [String.raw`$\frac{3}{4}$ of 80`, '3/4 of 80'],
    [String.raw`\(x^2 + 1\)`, 'x² + 1'],
    ['**Step 1:** multiply', 'Step 1: multiply'],
    ['## Answer', 'Answer'],
    ['- first\n- second', '• first\n• second'],
    [String.raw`4 \times 6 = 24`, '4 × 6 = 24'],
    [String.raw`\sqrt{81} = 9`, '√(81) = 9'],
    ['x^20 stays', 'x^20 stays'],
    [String.raw`\frac{x+1}{2}`, '(x+1)/(2)'],
  ])('turns %j into %j', (input, expected) => {
    expect(plainText(input)).toBe(expected)
  })
})
