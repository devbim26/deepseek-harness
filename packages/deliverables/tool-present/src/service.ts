/** Programmatic file declarations committed after the caller's successful tool result. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsError } from '@deepseek-ai/dsh-fs'
import { ToolArgsError, ToolContextUnavailableError, type ToolExecution, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { FileDeliveries, PresentedFile, PresentedFileResult } from './types.ts'
import type { Config } from './index.ts'

/** Local file-delivery provider mounted by tool-present. */
export class FileDeliveryRuntime extends Service implements FileDeliveries {
  static inject = ['fs', 'agents', 'workingDirectory']

  private readonly pending = new WeakMap<ToolExecution, { turn: number; files: PresentedFile[] }>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'fileDeliveries')
    ctx.on('tools/result', (exec, result) => {
      const delivery = this.pending.get(exec)
      this.pending.delete(exec)
      if (delivery === undefined || result.isError) return
      exec.agent?.session.append('deliverables/presented', {
        turn: delivery.turn, callId: exec.callId, files: delivery.files,
      })
    })
  }

  /**
   * Stage files for delivery after the current execution succeeds.
   * @param agent - exact live Agent owning the open turn.
   * @param files - existing regular files to declare.
   * @param exec - caller-owned tool execution and cancellation.
   * @returns the turn and canonical files staged for delivery.
   */
  async present(agent: Agent, files: readonly PresentedFile[], exec: ToolRunContext): Promise<PresentedFileResult> {
    if (exec.agent !== agent || this.ctx.agents.get(agent.id) !== agent) {
      throw new ToolContextUnavailableError('present requires the exact live calling agent')
    }
    const boundary = this.ctx.agents.turnBoundaryOf(agent.session)
    if (boundary.openTurnStartSeq === null) throw new ToolContextUnavailableError('present requires an open turn')
    if (files.length === 0 || files.length > this.config.maxFiles) {
      throw new ToolArgsError([`present accepts 1 to ${this.config.maxFiles} files`])
    }
    const cwd = await this.ctx.workingDirectory.ensure(agent, exec.signal)
    const options = { cwd, signal: exec.signal }
    const canonical: PresentedFile[] = []
    for (const file of files) {
      if (file.path.trim().length === 0) throw new ToolArgsError(['present requires a non-empty file path'])
      const entry = await this.ctx.fs.lstat(file.path, { cwd }, exec.signal)
      if (entry !== undefined && entry.type !== 'file') {
        throw new FsError(`Cannot present ${file.path}: not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      const target = await this.ctx.fs.resolve(file.path, options)
      const info = await this.ctx.fs.stat(target, exec.signal)
      if (info === undefined) {
        throw new FsError(`Cannot present ${file.path}: file not found. Check the path, create the file if needed, and retry.`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') throw new FsError(`Cannot present ${file.path}: not a regular file`, 'FS_NOT_REGULAR_FILE')
      canonical.push({ ...file, path: this.ctx.fs.processPath(target) })
    }
    exec.signal.throwIfAborted()
    this.pending.set(exec, { turn: boundary.lastTurn, files: canonical })
    return { turn: boundary.lastTurn, files: canonical }
  }
}
