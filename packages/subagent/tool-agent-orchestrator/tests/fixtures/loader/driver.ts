#!/usr/bin/env node
/** Test driver: one orchestrated turn through the shipped headless profile. */
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('orchestration composition driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'agent-orchestrator-composition-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const result = await runFixtureTurn(ctx, { task: 'orchestrate the review' })
  const parent = ctx.agents.get(SessionId(result.sessionId))
  if (parent === undefined) throw new Error('orchestrating parent is unavailable')
  await ctx.subagents.waitForTreeWork(parent)
  await parent.whenIdle()
  await ctx.sessions.flush(parent.session)
} finally {
  await ctx.fiber.dispose()
}
