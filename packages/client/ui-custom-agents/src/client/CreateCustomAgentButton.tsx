/** The custom-agent manager entry: a button a page renders wherever people create agents. */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomAgentsController } from './custom-agents-store.ts'

/** Manager handle supplied by the Factory definition. */
export interface CreateCustomAgentButtonInjected {
  /** The store controller; openManager hands off to the overlay-hosted dialog. */
  controller: CustomAgentsController
}

/**
 * Render the entry that opens the custom-agent manager. The dialog mounts in
 * `shell.overlay`, so it opens over any page that renders this Factory.
 * @param props - locale and the manager controller.
 * @returns the create button.
 */
export function CreateCustomAgentButton({ controller, t }: FactoryComponentPropsOf<'customAgents.createButton'>) {
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<IconPlusOutlineRegular size={13} />}
      aria-haspopup="dialog"
      onClick={() => { controller.openManager() }}
    >
      {t('open')}
    </Button>
  )
}
