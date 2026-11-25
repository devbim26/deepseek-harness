/** Deterministic Session-to-report conversion: selection, Markdown blocks, and images. */

import { describe, expect, it } from 'vitest'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { sessionReport } from '../src/session-report.ts'

const messageId = (value: string): MessageId => brandString<MessageId>(value)
const callId = (value: string): ToolCallId => brandString<ToolCallId>(value)
const attachmentId = (value: string): AttachmentId => brandString<AttachmentId>(value)
const sequence = (value: number): SessionSeq => brandNumber<SessionSeq>(value)
const SID = 'report-session' as SessionId

function titleEvent(seq: number, title: string): SessionEvent<'session/title'> {
  return {
    type: 'session/title',
    seq: sequence(seq),
    time: seq,
    data: { title, messageSeqs: [], source: { kind: 'fallback' } },
  }
}

function start(seq: number, turn: number): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq: sequence(seq), time: seq, data: { turn } }
}

function end(seq: number, turn: number): SessionEvent<'turn/end'> {
  return { type: 'turn/end', seq: sequence(seq), time: seq, data: { turn, reason: { kind: 'completed' } } }
}

function user(seq: number, text: string, kind: 'user' | 'injected' = 'user'): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: sequence(seq),
    time: seq,
    surfaceOp: 'append',
    data: {
      role: 'user',
      id: messageId(`user-${String(seq)}`),
      source: kind === 'user' ? { kind: 'user' } : { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'text', text }],
    },
  }
}

function assistant(seq: number, content: ContentBlock[], turn = 1): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: sequence(seq),
    time: seq,
    surfaceOp: 'append',
    data: {
      turn,
      step: 1,
      message: {
        role: 'assistant',
        id: messageId(`assistant-${String(seq)}`),
        source: { kind: 'model', provider: 'test', model: 'test' },
        content,
      },
      stream: [],
    },
  }
}

function text(value: string): ContentBlock {
  return { type: 'text', text: value }
}

function toolCall(seq: number, id: string, name: string): SessionEvent<'tool/call'> {
  return {
    type: 'tool/call',
    seq: sequence(seq),
    time: seq,
    data: { turn: 1, step: 1, callId: callId(id), name, arguments: '{}' },
  }
}

function toolResult(seq: number, id: string, content: ContentBlock[]): SessionEvent<'tool/result'> {
  return {
    type: 'tool/result',
    seq: sequence(seq),
    time: seq,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        id: messageId(`result-${String(seq)}`),
        source: { kind: 'tool', callId: callId(id) },
        toolCallId: callId(id),
        content,
        isError: false,
      },
    },
  }
}

function imageBlock(name: string): ContentBlock {
  return {
    type: 'image',
    attachment: {
      attachmentId: attachmentId(`image-${name}`),
      mediaType: 'image/png',
      bytes: 10,
      width: 2,
      height: 2,
      name,
    },
  }
}

/** Convert one final reply and drop the leading human message block. */
function replyBlocks(reply: string) {
  return sessionReport([start(1, 1), user(2, 'Вопрос'), assistant(3, [text(reply)]), end(4, 1)], SID).blocks.slice(1)
}

describe('sessionReport', () => {
  it('keeps human messages and the final reply of every turn', () => {
    const report = sessionReport([
      titleEvent(0, 'Отчёт по чертежам'),
      start(1, 1),
      user(2, 'Покажи листы'),
      assistant(3, [text('Смотрю чертежи.')]),
      toolCall(4, 'call-1', 'get_crop'),
      toolResult(5, 'call-1', [text('crop bytes')]),
      assistant(6, [text('Готово, листы показаны.')]),
      end(7, 1),
      start(8, 2),
      user(9, 'И ещё один'),
      assistant(10, [text('Второй ответ.')]),
      end(11, 2),
    ], SID)

    expect(report.title).toBe('Отчёт по чертежам')
    expect(report.blocks).toEqual([
      { type: 'text', heading: 'User', text: 'Покажи листы' },
      { type: 'text', heading: 'Assistant', text: 'Готово, листы показаны.' },
      { type: 'text', heading: 'User', text: 'И ещё один' },
      { type: 'text', heading: 'Assistant', text: 'Второй ответ.' },
    ])
  })

  it('omits reasoning, injected context, and intermediate assistant messages', () => {
    const report = sessionReport([
      start(1, 1),
      user(2, 'Вопрос'),
      user(3, 'INJECTED', 'injected'),
      assistant(4, [{ type: 'reasoning', text: 'REASONING' }, text('Промежуточно')]),
      assistant(5, [text('Финал')]),
      end(6, 1),
    ], SID)

    const rendered = JSON.stringify(report.blocks)
    expect(rendered).not.toContain('REASONING')
    expect(rendered).not.toContain('INJECTED')
    expect(rendered).not.toContain('Промежуточно')
    expect(rendered).toContain('Финал')
  })

  it('names the Session when the log carries no title', () => {
    const report = sessionReport([start(1, 1), user(2, 'Вопрос'), end(3, 1)], SID)
    expect(report.title).toBe('Session report report-session')
  })

  it('converts headings, tables, lists, and code fences into report blocks', () => {
    const reply = [
      '## Раздел',
      '',
      'Абзац ответа.',
      '',
      '| ID | Лист |',
      '| --- | --- |',
      '| W-1 | 38 |',
      '| W-2 | 39 |',
      '',
      '- пункт один',
      '- пункт два',
      '',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n')
    const report = sessionReport([start(1, 1), user(2, 'Вопрос'), assistant(3, [text(reply)]), end(4, 1)], SID)

    expect(report.blocks).toEqual([
      { type: 'text', heading: 'User', text: 'Вопрос' },
      { type: 'text', heading: 'Раздел', text: 'Абзац ответа.' },
      { type: 'table', header: ['ID', 'Лист'], rows: [['W-1', '38'], ['W-2', '39']] },
      { type: 'text', text: '- пункт один\n- пункт два' },
      { type: 'code', text: 'const x = 1' },
    ])
  })

  it('turns a fenced passage into a code block without fence markers and with its indentation', () => {
    const reply = 'Пояснение:\n\n```\n\n  if (a == 1) {\n    return **a**\n  }\n\n```\n\n```\n```\n\nГотово.'
    expect(replyBlocks(reply)).toEqual([
      { type: 'text', heading: 'Assistant', text: 'Пояснение:' },
      { type: 'code', text: '  if (a == 1) {\n    return **a**\n  }' },
      { type: 'text', text: 'Готово.' },
    ])
  })

  it('counts the code text of a reply', () => {
    const report = sessionReport([start(1, 1), user(2, 'Вопрос'), assistant(3, [text('```\nab\n```')]), end(4, 1)], SID)
    expect(report.textChars).toBe(50)
  })

  it('reads a table that follows a paragraph without a blank line', () => {
    const reply = 'Абзац ответа.\n| ID | Лист |\n| --- | --- |\n| W-1 | 38 |'
    const report = sessionReport([start(1, 1), user(2, 'Вопрос'), assistant(3, [text(reply)]), end(4, 1)], SID)
    expect(report.blocks).toEqual([
      { type: 'text', heading: 'User', text: 'Вопрос' },
      { type: 'text', heading: 'Assistant', text: 'Абзац ответа.' },
      { type: 'table', header: ['ID', 'Лист'], rows: [['W-1', '38']] },
    ])
  })

  it('keeps the alternative text of a Markdown image and drops its destination', () => {
    const reply = 'Смотри ![Лист 38](file:///tmp/secret/sheet-38.png) на чертеже.'
    const report = sessionReport([start(1, 1), user(2, 'Вопрос'), assistant(3, [text(reply)]), end(4, 1)], SID)
    const rendered = JSON.stringify(report.blocks)
    expect(rendered).toContain('Лист 38')
    expect(rendered).not.toContain('secret')
    expect(rendered).not.toContain('.png')
  })

  it('drops the destination of an image link inside a table cell and counts the carried text', () => {
    const reply = '| Sheet | Note |\n| --- | --- |\n| 38 | see ![crop](file:///secret/x.png) |'
    const report = sessionReport([start(1, 1), user(2, 'Вопрос'), assistant(3, [text(reply)]), end(4, 1)], SID)
    expect(report.blocks).toEqual([
      { type: 'text', heading: 'User', text: 'Вопрос' },
      { type: 'text', heading: 'Assistant', text: '' },
      { type: 'table', header: ['Sheet', 'Note'], rows: [['38', 'see crop']] },
    ])
    expect(report.textChars).toBe(67)
  })

  it('splits cells around escaped pipes and pipes inside single- and multi-backtick code', () => {
    const reply = [
      'Состав:',
      '',
      '| A | B | C |',
      '| --- | --- | --- |',
      '| `a|b` | ``a`|b`` | c |',
      '| d \\| e | | f |',
    ].join('\n')
    const report = sessionReport([start(1, 1), user(2, 'Вопрос'), assistant(3, [text(reply)]), end(4, 1)], SID)
    expect(report.blocks[2]).toEqual({
      type: 'table',
      header: ['A', 'B', 'C'],
      rows: [['`a|b`', '``a`|b``', 'c'], ['d | e', '', 'f']],
    })
  })

  it('drops an ATX heading that carries no text', () => {
    const reply = '## \n\n## ###\n\nТекст без заголовка.'
    const report = sessionReport([start(1, 1), user(2, 'Вопрос'), assistant(3, [text(reply)]), end(4, 1)], SID)
    expect(report.blocks[1]).toEqual({ type: 'text', heading: 'Assistant', text: 'Текст без заголовка.' })
  })

  it('counts the title, the structural headings, and the reply text', () => {
    const report = sessionReport([
      titleEvent(0, 'Пусто'), start(1, 1), user(2, 'Вопрос'), assistant(3, [text('Ответ')]), end(4, 1),
    ], SID)
    expect(report.textChars).toBe(29)
  })

  it('keeps a table header without a body row as text instead of stalling', () => {
    expect(replyBlocks('Заголовок:\n\n| Имя |\n| --- |')).toEqual([
      { type: 'text', heading: 'Assistant', text: 'Заголовок:' },
      { type: 'text', text: '| Имя |\n| --- |' },
    ])
    expect(replyBlocks('| a | b |\n| - | - |\n\nГотово.')).toEqual([
      { type: 'text', heading: 'Assistant', text: '| a | b |\n| - | - |' },
      { type: 'text', text: 'Готово.' },
    ])
  })

  it('flushes a heading that a fence, a table, or the end of the reply follows', () => {
    const reply = '## A\n\n- пункт\n\n## B\n\n```js\nx\n```\n## C\n\n| h |\n| - |\n| 1 |\n\n## D'
    expect(replyBlocks(reply)).toEqual([
      { type: 'text', heading: 'A', text: '- пункт' },
      { type: 'text', text: 'B' },
      { type: 'code', text: 'x' },
      { type: 'text', text: 'C' },
      { type: 'table', header: ['h'], rows: [['1']] },
      { type: 'text', text: 'D' },
    ])
  })

  it('ends a paragraph at a heading, a fence, or a list line that follows without a blank line', () => {
    expect(replyBlocks('Текст\n## Заголовок\n```\ncode\n```\n- пункт')).toEqual([
      { type: 'text', heading: 'Assistant', text: 'Текст' },
      { type: 'text', text: 'Заголовок' },
      { type: 'code', text: 'code' },
      { type: 'text', text: '- пункт' },
    ])
    expect(replyBlocks('Текст\n```\ncode\n```')).toEqual([
      { type: 'text', heading: 'Assistant', text: 'Текст' },
      { type: 'code', text: 'code' },
    ])
    expect(replyBlocks('Текст\n- пункт')).toEqual([
      { type: 'text', heading: 'Assistant', text: 'Текст' },
      { type: 'text', text: '- пункт' },
    ])
  })

  it('keeps an unclosed fence as code and a line with pipes but no delimiter row as text', () => {
    expect(replyBlocks('```js\nconst a = 1')).toEqual([
      { type: 'text', heading: 'Assistant', text: '' },
      { type: 'code', text: 'const a = 1' },
    ])
    expect(replyBlocks('Итог: a | b\nГотово.')).toEqual([
      { type: 'text', heading: 'Assistant', text: 'Итог: a | b\nГотово.' },
    ])
  })

  it('reads a table without outer pipes and ends it at a line without a pipe', () => {
    expect(replyBlocks('Состав:\n\na | b\n--- | ---\n1 | 2\nГотово.')).toEqual([
      { type: 'text', heading: 'Assistant', text: 'Состав:' },
      { type: 'table', header: ['a', 'b'], rows: [['1', '2']] },
      { type: 'text', text: 'Готово.' },
    ])
  })

  it('keeps pipe-only lines that form no table as text', () => {
    const reply = '|\n||\n|\n| --- |\n| a | b |\n\nx |\n||\n| 1 |'
    expect(replyBlocks(reply)).toEqual([
      { type: 'text', heading: 'Assistant', text: '|\n||\n|\n| --- |\n| a | b |' },
      { type: 'text', text: 'x |\n||\n| 1 |' },
    ])
  })

  it('replaces inline and reference image links and names an empty alternative text', () => {
    const blocks = replyBlocks('![](file:///secret/a.png) и ![Лист][ref] и ![][ref]')
    expect(blocks).toEqual([{ type: 'text', heading: 'Assistant', text: 'Image и Лист и Image' }])
    expect(JSON.stringify(blocks)).not.toContain('secret')
  })

  it('adds no image block for a call that has no committed result', () => {
    const report = sessionReport([
      start(1, 1), user(2, 'Покажи кроп'), toolCall(3, 'call-1', 'get_crop'), assistant(4, [text('Готово')]), end(5, 1),
    ], SID)
    expect(report.blocks.filter(block => block.type === 'image')).toEqual([])
  })

  it('embeds the latest result of each call once and names the tool and the call', () => {
    const report = sessionReport([
      start(1, 1),
      user(2, 'Покажи кроп'),
      toolCall(3, 'call-1', 'get_crop'),
      toolResult(4, 'call-1', [imageBlock('sheet.png')]),
      toolCall(5, 'call-1', 'get_crop'),
      toolResult(6, 'call-1', [imageBlock('sheet.png'), imageBlock('sheet-2.png')]),
      assistant(7, [text('Готово')]),
      end(8, 1),
    ], SID)

    const images = report.blocks.filter(block => block.type === 'image')
    expect(images).toEqual([{ type: 'image', callId: 'call-1', caption: 'get_crop / call-1' }])
  })

  it('labels a result without a recorded call as unknown instead of inventing a tool', () => {
    const report = sessionReport([
      start(1, 1),
      user(2, 'Покажи кроп'),
      toolResult(3, 'call-9', [imageBlock('sheet.png')]),
      assistant(4, [text('Готово')]),
      end(5, 1),
    ], SID)

    const images = report.blocks.filter(block => block.type === 'image')
    expect(images).toEqual([{ type: 'image', callId: 'call-9', caption: 'unknown / call-9' }])
  })

  it('counts the carried text and reports an empty Session without blocks', () => {
    const report = sessionReport([titleEvent(0, 'Пусто'), start(1, 1), end(2, 1)], SID)
    expect(report.blocks).toEqual([])
    expect(report.textChars).toBe('Пусто'.length)
  })

  it('does not mutate the supplied events', () => {
    const events = Object.freeze([
      Object.freeze(start(1, 1)),
      Object.freeze(user(2, 'Вопрос')),
      Object.freeze(assistant(3, [text('Ответ')])),
      Object.freeze(end(4, 1)),
    ])
    const report = sessionReport(events, SID)
    expect(report.blocks).toHaveLength(2)
    expect(events).toHaveLength(4)
  })
})
