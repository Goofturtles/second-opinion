import { describe, expect, it } from 'vitest'
import { compareAnswers, compareSets } from './compare'

describe('compareAnswers', () => {
  it.each([
    ['x = 5', '5'],
    ['3/4', '0.75'],
    ['.5', '0.5'],
    ['1 1/2', '1.5'],
    ['-1 1/2', '-1.5'],
    ['−3', '-3'],
    ['45°', '45'],
    ['50%', '50'],
    ['(B)', 'b'],
    ['y = 2x + 1', 'Y=2X+1'],
    ['1/3', '2/6'],
    ['x = 1 1/2', '1.5'],
    ['1 1/2%', '1.5'],
    ['1 1/3', '4/3'],
    ['0', '-0'],
    ['10 000', '10000'],
    ['1 000 000.5', '1000000.5'],
  ])('treats %j and %j as the same answer', (a, b) => {
    expect(compareAnswers(a, b)).toBe('agree')
  })

  it.each([
    ['12', '10'],
    ['3', '3.4'],
    ['y = 2x + 1', 'y = 2x - 1'],
    ['24', '-24'],
    ['0.33', '1/3'],
    ['11/2', '1 1/2'],
    ['x = 1 1/2', '5.5'],
    ['3 4', '34'],
    ['1000000000', '1000000001'],
    ['0.0000000001', '0.000000001'],
    ['1000000000000', '1000000000001'],
    ['2.000000000001', '2'],
    ['x = 3', 'y = 3'],
  ])('flags %j and %j as different', (a, b) => {
    expect(compareAnswers(a, b)).toBe('differ')
  })

  it('marks a question blank when either side is empty', () => {
    expect(compareAnswers('', '5')).toBe('blank')
    expect(compareAnswers('5', '   ')).toBe('blank')
    expect(compareAnswers('%', '°')).toBe('blank')
    expect(compareAnswers('%', '5')).toBe('blank')
  })

  it('does not divide by zero', () => {
    expect(compareAnswers('1/0', '1/0')).toBe('agree')
    expect(compareAnswers('1/0', '0')).toBe('differ')
  })
})

describe('compareSets', () => {
  it('reports every question, even when one side answered fewer', () => {
    expect(compareSets(['5'], ['5', '7'])).toEqual(['agree', 'blank'])
    expect(compareSets(['5', '7'], ['5'])).toEqual(['agree', 'blank'])
  })
})
