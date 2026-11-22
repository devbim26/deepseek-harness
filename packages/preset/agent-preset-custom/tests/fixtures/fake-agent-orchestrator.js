// Test-only orchestration engine: a scripted service that records the request
// it received and settles every run immediately.
export const name = 'fake-agent-orchestrator'

export function apply(ctx) {
  const runs = new Map()
  const requests = []
  ctx.effect(() => ctx.reflect.provide('agentOrchestrator', {
    requests,
    start(request) {
      requests.push(request)
      const id = `orchestration-${String(runs.size + 1)}`
      const snapshot = {
        id,
        status: 'complete',
        objective: request.objective,
        rounds: 1,
        summary: `finished ${request.objective}`,
        workers: request.assignments.map(assignment => ({ assignmentId: assignment.id, rounds: 1 })),
        assumptions: [],
        gaps: [],
      }
      const run = {
        id,
        result: Promise.resolve(snapshot),
        cancel() { snapshot.status = 'cancelled' },
        async dispose() {},
      }
      runs.set(id, { run, snapshot })
      return run
    },
    status(id) {
      return runs.get(id)?.snapshot
    },
  }), 'fake-agent-orchestrator')
}
