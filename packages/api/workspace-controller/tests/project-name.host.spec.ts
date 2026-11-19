import { describe, expect, it } from 'vitest'
import { isValidProjectName } from '../src/project-name.ts'

describe('isValidProjectName', () => {
  it.each([
    ['Жилой дом 12', true],
    ['Kotelnaya-2', true],
    ['a', true],
    ['x'.repeat(64), true],
    ['', false],
    ['x'.repeat(65), false],
    [' padded', false],
    ['padded ', false],
    ['dot.', false],
    ['.dot', false],
    ['.', false],
    ['..', false],
    ['a/b', false],
    ['a\\b', false],
    ['a<b', false], ['a>b', false], ['a:b', false], ['a"b', false],
    ['a|b', false], ['a?b', false], ['a*b', false],
    ['co\nn', false],
    ['CON', false], ['con', false], ['Prn', false], ['AuX', false],
    ['NUL', false], ['COM1', false], ['com9', false], ['LPT1', false],
    ['CONSOLE', true],
  ])('%s -> %s', (name, expected) => {
    expect(isValidProjectName(name)).toBe(expected)
  })
})
