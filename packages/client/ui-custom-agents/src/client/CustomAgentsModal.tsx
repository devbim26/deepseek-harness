/**
 * The custom-agent manager modal: the agent roster, the create/edit form, and
 * the deployment's tool whitelist plus delegate checklist in three panes. The
 * roster and tools scroll on their own so many agents stay reachable; fields
 * and tool checkboxes are bounded by the deployment policy the service
 * reports, and the service re-validates every write.
 */
import { useId, useState } from 'react'
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
const BLANK: CustomAgentInput = { name: '', description: '', instructions: '', tools: [], isOrchestrator: false, delegates: [], hidden: false }

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
  const listTitleId = useId()
  const settingsTitleId = useId()
  const toolsTitleId = useId()
  const delegatesTitleId = useId()

  const startCreate = (): void => {
    setEditing(undefined)
    setFields(BLANK)
    setDeleting(undefined)
    setFailure(undefined)
  }
  const startEdit = (record: CustomAgentRecord): void => {
    setEditing(record)
    setFields({
      name: record.name,
      description: record.description,
      instructions: record.instructions,
      tools: [...record.tools],
      isOrchestrator: record.isOrchestrator,
      delegates: [...record.delegates],
      hidden: record.hidden,
    })
    setDeleting(undefined)
    setFailure(undefined)
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
    if (message !== undefined) {
      setFailure(message)
      return
    }
    // Saved: the roster already refreshed; close so the next "New custom
    // agent" opens a fresh form instead of the previous one's editing state.
    onClose()
  }
  const remove = async (record: CustomAgentRecord): Promise<void> => {
    const outcome = await controller.remove(record.id, record.version)
    if (outcome.ok && editing?.id === record.id) startCreate()
    setFailure(outcomeMessage(outcome))
    setDeleting(undefined)
  }
  const policy = state.policy
  const delegateChoices = state.agents.filter(agent => agent.id !== editing?.id && !agent.isOrchestrator)

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
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={state.saving} onClick={() => { void submit() }}>{t('save')}</Button>
        </>
      )}
    >
      <div className={css.layout}>
        <aside className={css.agentsPane} aria-labelledby={listTitleId}>
          <div className={css.paneHead}>
            <h3 id={listTitleId} className={css.paneTitle}>{t('listTitle')}</h3>
            <span className={css.paneCount} aria-hidden="true">{state.agents.length}</span>
            <Button size="sm" variant="outline" className={css.paneAction} onClick={startCreate}>{t('newAgent')}</Button>
          </div>
          <div className={css.agentScroll}>
            {state.agents.length === 0 && <p className={css.empty}>{t('empty')}</p>}
            {state.agents.map(agent => (
              <div
                key={agent.id}
                className={css.row}
                data-active={editing?.id === agent.id ? 'true' : undefined}
              >
                <span className={css.rowText}>
                  <span className={css.rowName}>
                    {agent.name}
                    {agent.isOrchestrator && <span className={css.badge}>{t('orchestratorBadge')}</span>}
                    {agent.hidden && <span className={css.badge}>{t('hiddenBadge')}</span>}
                  </span>
                  {agent.description !== '' && <span className={css.rowDescription}>{agent.description}</span>}
                </span>
                {deleting?.id === agent.id ? (
                  <span className={css.confirm}>
                    <span className={css.confirmText}>{t('removeConfirm')}</span>
                    <span className={css.confirmActions}>
                      <Button size="sm" variant="outline" className={css.removeButton} onClick={() => { void remove(agent) }}>{t('remove')}</Button>
                      <Button size="sm" onClick={() => { setDeleting(undefined) }}>{t('cancel')}</Button>
                    </span>
                  </span>
                ) : (
                  <span className={css.rowActions}>
                    <Button size="sm" onClick={() => { startEdit(agent) }}>{t('edit')}</Button>
                    <Button size="sm" className={css.removeButton} onClick={() => { setDeleting(agent) }}>{t('remove')}</Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </aside>
        <form
          className={css.form}
          aria-labelledby={settingsTitleId}
          onSubmit={(event) => { event.preventDefault(); void submit() }}
        >
          <div className={css.paneHead}>
            <h3 id={settingsTitleId} className={css.paneTitle}>{t('settingsTitle')}</h3>
          </div>
          {failure !== undefined && <p className={css.failure} role="alert">{failure}</p>}
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="custom-agents-name">{t('name')}</label>
            <input
              id="custom-agents-name"
              data-modal-autofocus
              className={css.input}
              value={fields.name}
              placeholder={t('namePlaceholder')}
              maxLength={policy?.maxNameChars}
              onChange={(event) => { setFields({ ...fields, name: event.target.value }) }}
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
              onChange={(event) => { setFields({ ...fields, description: event.target.value }) }}
            />
          </div>
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="custom-agents-instructions">{t('instructions')}</label>
            <textarea
              id="custom-agents-instructions"
              className={`${css.input} ${css.textarea}`}
              rows={6}
              value={fields.instructions}
              placeholder={t('instructionsPlaceholder')}
              maxLength={policy?.maxInstructionsChars}
              onChange={(event) => { setFields({ ...fields, instructions: event.target.value }) }}
            />
            {policy !== undefined && <span className={css.counter}>{t('charsUsed', { used: fields.instructions.length, limit: policy.maxInstructionsChars })}</span>}
          </div>
          {policy?.delegationAvailable === true && (
            <div className={css.field}>
              <Checkbox
                label={t('orchestrator')}
                checked={fields.isOrchestrator}
                onChange={(checked) => { setFields({ ...fields, isOrchestrator: checked, ...(checked ? {} : { delegates: [] }) }) }}
              />
              <span className={css.toolDescription}>{t('orchestratorHint')}</span>
            </div>
          )}
          <div className={css.field}>
            <Checkbox
              label={t('visible')}
              checked={!fields.hidden}
              onChange={(checked) => { setFields({ ...fields, hidden: !checked }) }}
            />
            <span className={css.toolDescription}>{t('visibleHint')}</span>
          </div>
        </form>
        <div className={css.rightPane}>
          <section className={css.toolsPane} aria-labelledby={toolsTitleId}>
            <div className={css.paneHead}>
              <h3 id={toolsTitleId} className={css.paneTitle}>{t('tools')}</h3>
            </div>
            {policy !== undefined && (
              policy.allowedTools.length > 0 ? (
                <div className={css.toolScroll}>
                  {policy.allowedTools.map(tool => (
                    <div key={tool.key} className={css.tool}>
                      <Checkbox
                        label={tool.label}
                        checked={fields.tools.includes(tool.key)}
                        onChange={(checked) => {
                          setFields({
                            ...fields,
                            tools: checked ? [...fields.tools, tool.key] : fields.tools.filter(entry => entry !== tool.key),
                          })
                        }}
                      />
                      {tool.description !== undefined && tool.description !== '' && (
                        <span className={css.toolDescription}>{tool.description}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className={css.empty}>{t('noTools')}</p>
              )
            )}
          </section>
          <section className={css.delegatesPane} aria-labelledby={delegatesTitleId}>
            <div className={css.paneHead}>
              <h3 id={delegatesTitleId} className={css.paneTitle}>{t('delegatesTitle')}</h3>
            </div>
            <div className={fields.isOrchestrator ? css.toolScroll : `${css.toolScroll} ${css.delegatesDisabled}`}>
              {delegateChoices.length === 0
                ? <p className={css.empty}>{t('noDelegates')}</p>
                : delegateChoices.map(agent => (
                  <div key={agent.id} className={css.tool}>
                    <Checkbox
                      label={agent.name}
                      checked={fields.delegates.includes(agent.id)}
                      onChange={(checked) => {
                        setFields({
                          ...fields,
                          delegates: checked
                            ? [...fields.delegates, agent.id]
                            : fields.delegates.filter(entry => entry !== agent.id),
                        })
                      }}
                    />
                  </div>
                ))}
            </div>
          </section>
        </div>
      </div>
    </Modal>
  )
}
