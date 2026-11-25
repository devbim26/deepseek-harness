/** New-project dialog: one name under the Host's project base becomes a Workspace. */
import { useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import css from './WorkspaceBrowser.module.css'

type Props = Pick<WorkspaceBrowserProps, 'createProject' | 'startSession' | 't'> & {
  readonly onClose: () => void
}

/** @param props - create action, session starter, locale seat, and dismissal. @returns the creation dialog. */
export function NewProjectDialog({ createProject, startSession, onClose, t }: Props) {
  const composingRef = useRef(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = draft.trim()
  const blocked = busy || trimmed === ''

  const localizedError = (reason: unknown): string => {
    // The controller rejects createProject with WorkspaceProjectCreateError.
    // The documented error name keeps this feature package free of a runtime
    // import of the controller's client surface; rpcError.code picks the message.
    if (reason instanceof Error && reason.name === 'WorkspaceProjectCreateError') {
      const code = (reason as Error & { rpcError?: { code?: string } }).rpcError?.code
      if (code === 'workspace/project-exists') return t('project.error.exists')
      if (code === 'workspace/project-name-invalid') return t('project.error.invalid')
      return t('project.error.failed')
    }
    return reason instanceof Error ? reason.message : String(reason)
  }

  const close = () => {
    if (busy) return
    onClose()
  }

  const confirm = () => {
    if (blocked) return
    setBusy(true)
    setError(null)
    createProject({ name: trimmed }).then((workspace) => {
      setBusy(false)
      onClose()
      startSession(workspace.workspaceId, { clearPreviousDraft: false })
    }).catch((reason: unknown) => {
      setBusy(false)
      setError(localizedError(reason))
    })
  }

  return (
    <Modal open onClose={close} closeLabel={t('close')} title={t('project.new')}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>{t('project.create')}</Button>
        </>
      )}
    >
      <input
        className={css.renameInput}
        value={draft}
        aria-label={t('project.name')}
        placeholder={t('project.placeholder')}
        data-modal-autofocus
        disabled={busy}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !composingRef.current) {
            e.preventDefault()
            confirm()
          }
        }}
      />
      {error !== null && <div className={css.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
