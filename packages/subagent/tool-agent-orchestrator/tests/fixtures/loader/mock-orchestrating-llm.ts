import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'

function toolCall(id: string, name: string, args: object): StreamChunk[] {
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function text(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class MockOrchestratingAdapter extends LlmAdapter {
  private requestCount = 0

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requestCount += 1
    const id = `request-${this.requestCount}`
    const input = options.messages.flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (input.includes('Original objective:')) {
      if (!options.messages.some(message => message.role === 'tool')) {
        yield* toolCall(id, 'structured_output', {
          kind: 'follow-ups', followUps: [{ assignmentId: 'reviewer', question: 'Check the second fact' }],
        })
      } else {
        yield* toolCall(id, 'structured_output', {
          kind: 'complete', summary: 'consolidated', assumptions: [], gaps: [],
        })
      }
      return
    }

    if ((options.tools ?? []).some(tool => tool.name === 'structured_output')) {
      yield* toolCall(id, 'structured_output', {
        summary: input.includes('Follow-up for your previous work:') ? 'WORKER_ROUND_2' : 'WORKER_ROUND_1',
        evidence: ['fact'], assumptions: [], gaps: [],
      })
      return
    }

    if ((options.tools ?? []).some(tool => tool.name === 'orchestrate_agents')) {
      if (!options.messages.some(message => message.role === 'tool')) {
        yield* toolCall(id, 'orchestrate_agents', { objective: 'Verify Loader composition' })
      } else {
        yield* text('PARENT_COMPLETE')
      }
      return
    }

    yield* toolCall(id, 'structured_output', {
      summary: input.includes('Follow-up for your previous work:') ? 'WORKER_ROUND_2' : 'WORKER_ROUND_1',
      evidence: ['fact'], assumptions: [], gaps: [],
    })
  }
}

export const name = 'mock-orchestrating-llm'
export const inject = ['llm']

/** Register the deterministic parent/worker/evaluator script.
 * @param ctx - plugin context supplying the LLM registry.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mock'], new MockOrchestratingAdapter())
}
