/** Host-only delivery service contract kept out of the Client-safe payload face. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { PresentedFile, PresentedFileResult } from './types.ts'

/** Scoped programmatic file-delivery service used by composite tools. */
export interface FileDeliveries {
  /**
   * Validate and stage files for delivery after the caller's successful final tool result.
   * @param agent - exact live Agent owning the open turn.
   * @param files - existing regular files to declare.
   * @param exec - the caller's own tool execution and cancellation.
   * @returns the open turn and canonical file paths.
   */
  present(agent: Agent, files: readonly PresentedFile[], exec: ToolRunContext): Promise<PresentedFileResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileDeliveries: FileDeliveries
  }
}
