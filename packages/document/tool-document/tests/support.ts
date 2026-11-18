/** Shared composition for document_read tests: real services over a temp home. */

import { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { unsupportedInbox, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import * as ToolDocument from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** Attachment helper result: the durable reference and its host path. */
export interface AttachedFile {
  ref: FileAttachmentRef
  hostPath: string
}

/** Test composition over real Cordis services and one calling Agent. */
export interface Setup {
  ctx: Context
  agent: Agent
  session: Session
  root: string
  attach: (name: string, data: Uint8Array) => Promise<AttachedFile>
  execute: (args: Record<string, unknown>) => Promise<ToolExecutionResult>
}

async function agent(ctx: Context, cwd: string): Promise<Agent> {
  const id = SessionId(`document-owner-${++callNumber}`)
  let scope: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, value) }, { inject: ['tools'] }))
  await ctx.agents.register(value)
  return value
}

async function attachFile(
  ctx: Context, session: Session, name: string, data: Uint8Array,
): Promise<AttachedFile> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('attachment store missing')
  const ref = await attachments.saveFile({ data, name })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `Attached ${name}` }, { type: 'file', attachment: ref }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const hostPath = attachments.fileHostPath(ref)
  if (hostPath === undefined) throw new Error('attachment host path missing')
  return { ref, hostPath }
}

/** Compose the real services the tool injects over a temp workspace and home. */
export async function compose(overrides: Partial<ToolDocument.Config> = {}): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-document-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  await ctx.plugin(ToolDocument, overrides)
  const owner = await agent(ctx, root)
  const execute = (args: Record<string, unknown>) => executeToolFixture(ctx, {
    signal: new AbortController().signal,
    callId: ToolCallId(`document-${++callNumber}`),
    name: 'document_read',
    arguments: args,
    agent: owner,
  })
  return {
    ctx, agent: owner, session: owner.session, root,
    attach: (name, data) => attachFile(ctx, owner.session, name, data),
    execute,
  }
}
