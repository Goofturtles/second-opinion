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
    [String.raw`\frac{x+1}{2}`, '(x+1)/2'],
    // Meaning must survive: these used to come out as different maths.
    [String.raw`$2^{3x} = 64$`, '2^(3x) = 64'],
    [String.raw`x^{2.5}`, 'x^(2.5)'],
    ['x^2.5', 'x^2.5'],
    [String.raw`a_{n+1}`, 'a_(n+1)'],
    [String.raw`\frac{1}{x^{2}}`, '1/x²'],
    ['A book costs $12 and a pen costs $3.', 'A book costs $12 and a pen costs $3.'],
    ['Line one costs $5\nLine two $x = 2$', 'Line one costs $5\nLine two x = 2'],
    // Symbols students meet in geometry and trig.
    [String.raw`30^\circ`, '30°'],
    [String.raw`\pi r^2`, 'π r²'],
    [String.raw`1 + 2 + \cdots + n`, '1 + 2 + … + n'],
    [String.raw`\sin \theta`, 'sin θ'],
  ])('turns %j into %j', (input, expected) => {
    expect(plainText(input)).toBe(expected)
  })
})
