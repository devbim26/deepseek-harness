/** Row actions for one stored agent: a page renders them beside its roster row. */
import { useEffect, useState } from 'react'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseOutlineRegular, IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomAgentsController } from './custom-agents-store.ts'
import css from './AgentActions.module.css'

/** Caller-owned identity of the agent these actions address. */
export interface AgentActionsProps {
  /** Roster id of the agent. */
  id: string
  /** Version stamp from the caller's catalog read; a stale stamp answers conflict. */
  version: number
  /** Display name of the agent, for the accessible labels of the icon-only pair. */
  name: string
}

/** Business face supplied by the Factory definition. */
export interface AgentActionsInjected {
  /** The store controller; edit opens the manager dialog, remove writes through it. */
  controller: CustomAgentsController
}

/** How long an armed remove waits for its confirming press before disarming. */
const ARM_HOLD_MS = 3000

/** How long a failed remove keeps its reason visible before the buttons return. */
const FAILURE_HOLD_MS = 6000

/**
 * Render the icon-only edit and remove pair, stacked. Edit opens the manager
 * dialog on that agent; remove arms on the first press (the button fills with
 * the error color) and deletes on the confirming press, reporting a refused
 * write in place for a few seconds.
 * @param props - the agent's roster identity and name, the manager controller, and the locale seat.
 * @returns the actions, or the failure notice standing in for them.
 */
export function AgentActions({ id, version, name, controller, t }: FactoryComponentPropsOf<'customAgents.agentActions'>) {
  const [armed, setArmed] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => { setArmed(false) }, ARM_HOLD_MS)
    return () => { clearTimeout(timer) }
  }, [armed])
  useEffect(() => {
    if (failure === undefined) return
    const timer = setTimeout(() => { setFailure(undefined) }, FAILURE_HOLD_MS)
    return () => { clearTimeout(timer) }
  }, [failure])
  const remove = async (): Promise<void> => {
    const outcome = await controller.remove(id, version)
    if (outcome.ok) {
      setArmed(false)
      return
    }
    // A conflict names the fix; an unreachable deployment covers the rest.
    setFailure(outcome.kind === 'conflict' ? t('conflict') : outcome.kind === 'unavailable' ? t('errorUnavailable') : t('removeFailed'))
  }
  if (failure !== undefined) {
    return <span className={css.failure} role="alert">{failure}</span>
  }
  return (
    <span className={css.actions}>
      <button
        type="button"
        className={css.action}
        aria-label={`${t('edit')}: ${name}`}
        title={t('edit')}
        onClick={() => { controller.openManager(id) }}
      >
        <IconEditOutlineRegular size={14} />
      </button>
      <button
        type="button"
        className={armed ? `${css.action} ${css.actionRemove} ${css.actionArmed}` : `${css.action} ${css.actionRemove}`}
        aria-label={`${t('remove')}: ${name}`}
        title={armed ? t('removeConfirm') : t('remove')}
        onClick={() => {
          if (!armed) {
            setArmed(true)
            return
          }
          void remove()
        }}
      >
        <IconCloseOutlineRegular size={14} />
      </button>
    </span>
  )
}
