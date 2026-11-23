/** Durable file deliveries produced by the present tool. */
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

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Declared filesystem files from a successful final present result, including nested calls. */
    'deliverables/presented': { turn: number; callId: ToolCallId; files: PresentedFile[] }
  }
}
