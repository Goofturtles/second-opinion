import { DEMO_CODE } from './limits.ts'

// The public practice set, so anyone can try Second Opinion alone. A pretend friend has already
// answered and slipped on Q3. The page compares against it locally (instant, and it works while
// the free server is asleep); the server knows it too, for anyone calling the API directly.
export const DEMO = {
  code: DEMO_CODE,
  title: 'Ch. 7 review · p. 212',
  friendName: 'Maya',
  prompts: ['Solve 3x + 5 = 20', '1/2 + 1/4', '15% of 80', 'Slope of y = 2x − 7', '√81', '−4 × −6'],
  answers: ['x = 5', '0.75', '10', '2', '9', '24'],
}
