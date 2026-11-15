/**
 * The custom-agent manager modal: the site's agent list plus the create/edit
 * form. Fields and tool checkboxes are bounded by the deployment policy the
 * service reports; the service re-validates every write.
 */
import { useState } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Checkbox, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomAgentInput, CustomAgentRecord } from '@deepseek-ai/dsh-agent-preset-custom/types'
import type { CustomAgentsController, CustomAgentsState, WriteOutcome } from './custom-agents-store.ts'
import css from './CustomAgentsModal.module.css'

/** The modal composes the store hooks, the controller, and the locale seat. */
export interface CustomAgentsModalProps {
  /** Shared locale seat for the customAgents namespace. */
  t: TranslateNS<'customAgents'>
  /** Selector hook bound from the inject.hooks compartment. */
  useCustomAgents: SnapshotSelectorHook<CustomAgentsState>
  /** The store controller for create/update/remove. */
  controller: CustomAgentsController
  /** Close the modal. */
  onClose: () => void
}

/** Blank form fields for a create. */
const BLANK: CustomAgentInput = { name: '', description: '', instructions: '', tools: [] }

/**
 * Render the manager over the catalog store.
 * @param props - locale, store hook, controller, and the close command.
 * @returns the dialog, or null while the modal is unmounted.
 */
export function CustomAgentsModal({ t, useCustomAgents, controller, onClose }: CustomAgentsModalProps) {
  const state = useCustomAgents(value => value)
  const [editing, setEditing] = useState<CustomAgentRecord | undefined>(undefined)
  const [fields, setFields] = useState<CustomAgentInput>(BLANK)
  const [deleting, setDeleting] = useState<CustomAgentRecord | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const startEdit = (record: CustomAgentRecord): void => {
    setEditing(record)
    setFields({ name: record.name, description: record.description, instructions: record.instructions, tools: [...record.tools] })
    setFailure(undefined)
    setSaved(false)
  }
  const outcomeMessage = (outcome: WriteOutcome): string | undefined => {
    if (outcome.ok) return undefined
    if (outcome.kind === 'limit') return t('limitReached')
    if (outcome.kind === 'conflict') return t('conflict')
    if (outcome.kind === 'unavailable') return t('errorUnavailable')
    return t('invalidInput', { reason: outcome.reason ?? '' })
  }
  const submit = async (): Promise<void> => {
    // The obvious empty-field cases answer locally in the site language; the
    // service's coded reasons cover what remains.
    const missing = fields.name.trim() === ''
      ? t('nameRequired')
      : fields.instructions.trim() === '' ? t('instructionsRequired') : undefined
    if (missing !== undefined) {
      setFailure(missing)
      return
    }
    const outcome = editing === undefined
      ? await controller.create(fields)
      : await controller.update(editing.id, fields, editing.version)
    const message = outcomeMessage(outcome)
    setFailure(message)
    if (message === undefined) {
      setSaved(true)
      setEditing(undefined)
      setFields(BLANK)
    }
  }
  const remove = async (record: CustomAgentRecord): Promise<void> => {
    const outcome = await controller.remove(record.id, record.version)
    setFailure(outcomeMessage(outcome))
    setDeleting(undefined)
  }
  const policy = state.policy

  return (
    <Modal
      open
      onClose={onClose}
      title={editing === undefined ? t('createTitle') : t('editTitle')}
      closeLabel={t('cancel')}
      className={css.dialog ?? ''}
      contentClassName={css.content ?? ''}
      footer={(
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="outline" disabled={state.saving} onClick={() => { void submit() }}>{t('save')}</Button>
        </>
      )}
    >
      <div className={css.layout}>
        <section className={css.list} aria-label={t('open')}>
          {state.agents.length === 0 && <p className={css.empty}>{t('empty')}</p>}
          {state.agents.map(agent => (
            <div key={agent.id} className={css.row}>
              <span className={css.rowText}>
                <span className={css.rowName}>{agent.name}</span>
                {agent.description !== '' && <span className={css.rowDescription}>{agent.description}</span>}
              </span>
              {deleting?.id === agent.id ? (
                <span className={css.confirm}>
                  <span className={css.confirmText}>{t('removeConfirm')}</span>
                  <Button size="sm" variant="outline" onClick={() => { void remove(agent) }}>{t('remove')}</Button>
                  <Button size="sm" onClick={() => { setDeleting(undefined) }}>{t('cancel')}</Button>
                </span>
              ) : (
                <span className={css.rowActions}>
                  <Button size="sm" onClick={() => { startEdit(agent) }}>{t('edit')}</Button>
                  <Button size="sm" onClick={() => { setDeleting(agent) }}>{t('remove')}</Button>
                </span>
              )}
            </div>
          ))}
        </section>
        <form className={css.form} aria-label={t('createTitle')} onSubmit={(event) => { event.preventDefault(); void submit() }}>
          {failure !== undefined && <p className={css.failure}>{failure}</p>}
          {saved && failure === undefined && <p className={css.saved}>{t('saved')}</p>}
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="custom-agents-name">{t('name')}</label>
            <input
              id="custom-agents-name"
              data-modal-autofocus
              className={css.input}
              value={fields.name}
              placeholder={t('namePlaceholder')}
              maxLength={policy?.maxNameChars}
              onChange={(event) => { setFields({ ...fields, name: event.target.value }); setSaved(false) }}
            />
          </div>
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="custom-agents-description">{t('description')}</label>
            <input
              id="custom-agents-description"
              className={css.input}
              value={fields.description}
              placeholder={t('descriptionPlaceholder')}
              maxLength={policy?.maxDescriptionChars}
              onChange={(event) => { setFields({ ...fields, description: event.target.value }); setSaved(false) }}
            />
          </div>
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="custom-agents-instructions">{t('instructions')}</label>
            <textarea
              id="custom-agents-instructions"
              className={css.input}
              rows={6}
              value={fields.instructions}
              placeholder={t('instructionsPlaceholder')}
              maxLength={policy?.maxInstructionsChars}
              onChange={(event) => { setFields({ ...fields, instructions: event.target.value }); setSaved(false) }}
            />
            {policy !== undefined && <span className={css.counter}>{t('charsUsed', { used: fields.instructions.length, limit: policy.maxInstructionsChars })}</span>}
          </div>
          {policy !== undefined && policy.allowedTools.length > 0 && (
            <fieldset className={css.tools}>
              <legend className={css.fieldLabel}>{t('tools')}</legend>
              {policy.allowedTools.map(tool => (
                <Checkbox
                  key={tool}
                  label={tool}
                  checked={fields.tools.includes(tool)}
                  onChange={(checked) => {
                    setFields({
                      ...fields,
                      tools: checked ? [...fields.tools, tool] : fields.tools.filter(entry => entry !== tool),
                    })
                  }}
                />
              ))}
            </fieldset>
          )}
        </form>
      </div>
    </Modal>
  )
}
