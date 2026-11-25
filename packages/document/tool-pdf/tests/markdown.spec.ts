/** The Markdown subset a report text block accepts: inline runs, block fragments, and cell highlighting. */

import { describe, expect, it } from 'vitest'
import { isHighlightedCell, parseInlineRuns, parseTextBlock, stripInlineMarks } from '../src/markdown.ts'

const plain = (text: string) => ({ text, bold: false, mark: false })

describe('parseInlineRuns', () => {
  it('leaves plain text as one unstyled run', () => {
    expect(parseInlineRuns('Простой текст отчёта')).toEqual([plain('Простой текст отчёта')])
  })

  it('returns no runs for an empty line', () => {
    expect(parseInlineRuns('')).toEqual([])
  })

  it('marks bold and highlight spans, drops code backticks, and merges equal neighbors', () => {
    expect(parseInlineRuns('Итог: ==3 замечания== из **5 узлов**, код `x-1`.'))
      .toEqual([
        plain('Итог: '),
        { text: '3 замечания', bold: false, mark: true },
        plain(' из '),
        { text: '5 узлов', bold: true, mark: false },
        plain(', код x-1.'),
      ])
  })

  it('keeps an unclosed marker as literal text', () => {
    expect(parseInlineRuns('**открыто и ==тоже')).toEqual([plain('**открыто и ==тоже')])
    expect(parseInlineRuns('a ==b** c')).toEqual([plain('a ==b** c')])
  })

  it('splits adjacent bold spans instead of merging across them', () => {
    expect(parseInlineRuns('**a** **b**')).toEqual([
      { text: 'a', bold: true, mark: false },
      plain(' '),
      { text: 'b', bold: true, mark: false },
    ])
  })
})

describe('stripInlineMarks', () => {
  it('removes the markers and keeps the text', () => {
    expect(stripInlineMarks('==x== **y** `z`')).toBe('x y z')
  })

  it('keeps text without markers and literal pipes unchanged', () => {
    expect(stripInlineMarks('a | b **c')).toBe('a | b **c')
  })
})

describe('isHighlightedCell', () => {
  it('highlights a cell that carries a mark, as its whole text or inside longer text', () => {
    expect(isHighlightedCell('==12 500==')).toBe(true)
    expect(isHighlightedCell('  ==x== ')).toBe(true)
    expect(isHighlightedCell('PART(==нет маркировки==)')).toBe(true)
    expect(isHighlightedCell('==a== и ==b==')).toBe(true)
  })

  it('does not highlight a plain cell or one with an unclosed marker', () => {
    expect(isHighlightedCell('x')).toBe(false)
    expect(isHighlightedCell('итог ==x')).toBe(false)
    expect(isHighlightedCell('')).toBe(false)
  })
})

describe('parseTextBlock', () => {
  it('returns no fragments for blank text', () => {
    expect(parseTextBlock('')).toEqual([])
    expect(parseTextBlock('  \n \n')).toEqual([])
  })

  it('renders each non-empty line as its own paragraph', () => {
    expect(parseTextBlock('Первый.\r\nВторой.')).toEqual([
      { kind: 'paragraph', runs: [plain('Первый.')], spaced: false },
      { kind: 'paragraph', runs: [plain('Второй.')], spaced: false },
    ])
  })

  it('spaces only a paragraph that follows another paragraph across an empty line', () => {
    expect(parseTextBlock('\nA\n\n\n## Заголовок\n\nB\n\n- пункт\n\nC')).toEqual([
      { kind: 'paragraph', runs: [plain('A')], spaced: false },
      { kind: 'heading', level: 2, runs: [plain('Заголовок')] },
      { kind: 'paragraph', runs: [plain('B')], spaced: false },
      { kind: 'list', items: [{ marker: '•', runs: [plain('пункт')] }] },
      { kind: 'paragraph', runs: [plain('C')], spaced: false },
    ])
    expect(parseTextBlock('A\n\nB')).toEqual([
      { kind: 'paragraph', runs: [plain('A')], spaced: false },
      { kind: 'paragraph', runs: [plain('B')], spaced: true },
    ])
  })

  it('maps heading levels 1 to 3 and clamps deeper ones to the third', () => {
    const fragments = parseTextBlock('# Один\n## Два\n### Три\n#### Четыре\n####### Семь')
    expect(fragments.map(fragment => fragment.kind === 'heading' ? fragment.level : fragment.kind))
      .toEqual([1, 2, 3, 3, 'paragraph'])
  })

  it('keeps a line without a space after the hashes as a paragraph and drops closing hashes', () => {
    expect(parseTextBlock('#A\n## Заголовок ##')).toEqual([
      { kind: 'paragraph', runs: [plain('#A')], spaced: false },
      { kind: 'heading', level: 2, runs: [plain('Заголовок')] },
    ])
  })

  it('drops thematic breaks without spacing the paragraphs around them', () => {
    expect(parseTextBlock('A\n---\n***\n___\nB')).toEqual([
      { kind: 'paragraph', runs: [plain('A')], spaced: false },
      { kind: 'paragraph', runs: [plain('B')], spaced: false },
    ])
  })

  it('groups bullet and numbered items into one list, across empty lines, and keeps the numbering', () => {
    expect(parseTextBlock('- a\n* b\n1. c\n2) d\n\n+ e')).toEqual([{
      kind: 'list',
      items: [
        { marker: '•', runs: [plain('a')] },
        { marker: '•', runs: [plain('b')] },
        { marker: '1.', runs: [plain('c')] },
        { marker: '2)', runs: [plain('d')] },
        { marker: '•', runs: [plain('e')] },
      ],
    }])
  })

  it('keeps a phone number and a bold span at the line start out of lists, and renders a bare marker as an empty item', () => {
    expect(parseTextBlock('+7 999 000-00-00\n**Жирно**\n- \n-\n1.')).toEqual([
      { kind: 'paragraph', runs: [plain('+7 999 000-00-00')], spaced: false },
      { kind: 'paragraph', runs: [{ text: 'Жирно', bold: true, mark: false }], spaced: false },
      { kind: 'list', items: [{ marker: '•', runs: [] }, { marker: '•', runs: [] }, { marker: '1.', runs: [] }] },
    ])
  })

  it('builds a table from pipe rows and drops the separator row', () => {
    expect(parseTextBlock('ID | Лист | Статус\n--- | :---: | ---:\nW-1 | 38 | OK')).toEqual([{
      kind: 'table',
      header: ['ID', 'Лист', 'Статус'],
      rows: [['W-1', '38', 'OK']],
    }])
  })

  it('builds a table without a separator row and keeps each cell source text up to the table layout', () => {
    expect(parseTextBlock('| **A** | `x` |\n| ==y== | z |')).toEqual([{
      kind: 'table',
      header: ['**A**', '`x`'],
      rows: [['==y==', 'z']],
    }])
  })

  it('builds a table from a pipe row followed by a separator without pipes', () => {
    expect(parseTextBlock('Цена | 100\n---')).toEqual([{ kind: 'table', header: ['Цена', '100'], rows: [] }])
  })

  it('keeps a pipe row that ends the text as a paragraph', () => {
    expect(parseTextBlock('a | b')).toEqual([{ kind: 'paragraph', runs: [plain('a | b')], spaced: false }])
  })

  it('keeps a table that carries only a header row', () => {
    expect(parseTextBlock('a | b\n---|---')).toEqual([{ kind: 'table', header: ['a', 'b'], rows: [] }])
  })

  it('keeps a lone pipe line as a paragraph text', () => {
    expect(parseTextBlock('a | b\nобычный текст')).toEqual([
      { kind: 'paragraph', runs: [plain('a | b')], spaced: false },
      { kind: 'paragraph', runs: [plain('обычный текст')], spaced: false },
    ])
  })
})
