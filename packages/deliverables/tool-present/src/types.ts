/** Durable file deliveries produced by the present tool. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

/** A declared filesystem file whose current contents remain at its source path. */
export interface PresentedFile {
  /** Original absolute path or path relative to the Session working directory. */
  path: string
  /** Optional description supplied by the model. */
  description?: string
}

/** A successful file declaration awaiting its authoritative tool result. */
export interface PresentedFileResult {
  /** Open turn receiving the delivery. */
  readonly turn: number
  /** Canonical files declared for delivery. */
  readonly files: PresentedFile[]
}

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

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Declared filesystem files from a successful final present result, including nested calls. */
    'deliverables/presented': { turn: number; callId: ToolCallId; files: PresentedFile[] }
  }
}
