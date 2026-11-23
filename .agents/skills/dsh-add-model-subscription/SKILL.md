---
name: dsh-add-model-subscription
description: Use when a deployment must reach a model provider through a subscription key (Z.AI coding plan, Kimi Code, MiniMax coding plan, or another key-based plan) instead of pay-as-you-go credentials, to wire that provider into an overlay and prove the deployment lists and calls the subscribed models.
---

# DSH Add Model Subscription

A subscription plan authenticates with one long-lived key that the vendor's console issues for that plan. The deployment keeps the key in its environment file and names the provider route in the overlay; the route itself stays free of secrets.

## Scope

Use this skill for a provider route whose credential is a subscription key:

- Z.AI coding plan (`zai-coding-cn`, `zai`);
- Kimi Code (`kimi-coding`);
- MiniMax coding plan (`minimax`, `minimax-cn`);
- any other key-based plan whose provider the installed pi-ai catalog ships.

Pay-as-you-go platform keys are the same wiring, but they bill separately from the subscription and fail with an insufficient-balance error rather than an authentication error. Say which kind of key the route carries: the vendor's two services accept different keys and reject each other.

## Find the deployment surface

A deployment reaches its providers through two files plus one restart:

- the overlay (patch) that configures `llm-pi-ai` — for the client site, `packages/bundle/web-app/client-north-waterfront.patch.yml`;
- the environment file the launcher loads into the process — for the client site, `.env.north-waterfront` (gitignored);
- the launcher that starts the deployment with that environment — for the client site, `dsh-web-north-waterfront.cmd`.

Read the overlay's `llm-pi-ai` row before changing it: the `providers` value is one JavaScript expression that computes the whole dictionary, and every subscription route in that deployment already follows one shape.

## Find the provider in the installed catalog

The route name must match a provider the installed pi-ai catalog ships, so the endpoint, wire protocol, and model catalog are inherited instead of restated:

- `packages/llm/llm-pi-ai/src/provider-data.generated.ts` lists the installed provider ids, their credential variable, and their default base URL;
- `node_modules/@earendil-works/pi-ai/dist/providers/<id>.js` gives the provider's endpoint, protocol, and credential variable;
- `node_modules/@earendil-works/pi-ai/dist/providers/data/<id>.json` gives the model ids the catalog knows.

A provider with no catalog entry needs a hand-declared route: `api`, `baseURL`, and `models` are then stated explicitly, as the adapter README documents.

## Verify the key against the provider

Before wiring anything, check the key against the provider's own endpoint and read the model list it serves:

- the key's plan decides the endpoint — a Kimi Code key is refused by `api.moonshot.ai` and a MiniMax coding key by the pay-as-you-go API;
- the international and China hosts are separate routes (`kimi-coding` serves `api.kimi.ai`, `minimax` serves `api.minimax.io`);
- the vendor's model list is the source of truth for the ids the plan serves, and it is usually newer than the installed catalog.

A key that authenticates but cannot generate (balance, quota, plan tier) is not ready to wire: the failure appears in the client's turn, not at boot.

## Put the key in the deployment environment

Append the credential to the deployment's environment file under the variable the catalog provider reads (`ZAI_CODING_CN_API_KEY`, `KIMI_API_KEY`, `MINIMAX_API_KEY`). The launcher loads that file into the process environment; the overlay never carries the key, and the file stays out of version control.

## Wire the route in the overlay

The route is one spread in the `providers` expression, guarded by the credential's presence, so a deployment without the key lists no catalog for it:

```yaml
providers: !!js "(() => {
  const ids = (process.env.NW_MODELS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  ...
  return {
    ...((process.env.MINIMAX_API_KEY ?? '').trim() === '' ? {} : {
      'minimax': { apiKeyEnv: 'MINIMAX_API_KEY', displayName: 'MiniMax' },
    }),
  };
})()"
```

Rules for the expression:

- **No `//` comments inside the scalar.** YAML folds the lines of a double-quoted scalar into one line, so the first `//` comments out the rest of the expression — including its `return`. The providers dictionary then evaluates to `undefined`, the adapter starts with no routes, and the model picker is empty for every provider, not only the new one. Keep the rationale in the `#` comments above the row.
- The route name is the installed catalog provider id; `apiKeyEnv` names the credential, `displayName` labels the group in the picker.
- Pin `baseURL` only when the catalog's host is the wrong region or the wrong plan (Kimi's catalog host is China, the international plan needs `api.kimi.ai`).
- Restate `models` only when the plan serves ids the catalog does not know; the catalog models keep their own context window and capacity, and a restated entry falls back to the route's default context window.

The route's models, the endpoint, and the protocol then appear in the picker as their own group, next to the deployment's pay-as-you-go routes.

## Verify the wiring

Three checks, cheapest first. The first two catch the failures that leave the deployment silently without models.

1. **Parse the overlay the way the loader parses it.** The loader reads YAML with `js-yaml`, so evaluate the expression after `js-yaml` folding — not the raw file text:

```sh
node -e "
const fs = require('fs'); const yaml = require('js-yaml');
const jsType = new yaml.Type('!js', { kind: 'scalar', resolve: () => true, construct: (s) => s });
const schema = yaml.DEFAULT_SCHEMA.extend([jsType]);
const text = fs.readFileSync(process.argv[1], 'utf8').replace(/!!js/g, '!js');
const doc = yaml.load(text, { schema });
const rows = Array.isArray(doc) ? doc : [doc];
let expr; const walk = (r) => { for (const row of r) { if (row.id === 'llm-pi-ai') expr = row.config.providers; if (row.insert) walk(row.insert); } };
walk(rows);
console.log(Object.keys(eval('(' + expr + ')')));
" packages/bundle/web-app/client-north-waterfront.patch.yml
```

The route list must contain the new route with the key set, and must not contain it with the key unset.

2. **Mount the real composition.** The service plus the adapter with the exact route configuration answers what the client will see: `listModels(provider)` returns the catalog, and one stream through the route proves the credential, the endpoint, and the protocol together:

```ts
const ctx = new Context()
await ctx.plugin(LlmRuntime)
await ctx.plugin(LlmPiAi, { providers })
console.log((await ctx.llm.listModels('minimax')).map((m) => m.id))
for await (const chunk of ctx.llm.stream({
  provider: 'minimax',
  model: 'MiniMax-M3',
  messages: [createUserMessage({
    content: [{ type: 'text', text: 'Reply with exactly one word: OK' }],
    source: { kind: 'model', provider: 'minimax', model: 'MiniMax-M3' },
  })],
})) { /* text-delta chunks */ }
```

Run it from the repository root with the workspace's Node (`node --import tsx/esm <file>.mts`), with the real credential in the environment, and delete the scratch file afterwards.

3. **Check the running deployment.** Restart it through its launcher — the environment file is read at start, so a restart is what applies the key — and ask the host for the session model catalog over the authenticated RPC (`POST /api/session/modelCatalog` with a `client-request` envelope). The response names every routable provider and the models of each group; the new route must appear with its model list.

## Document the change

The deployment's own document states which keys the environment file carries and how each subscription route appears. Update it in the same change: the key's variable name, the route name, the endpoint and protocol the route inherits, and the models the plan serves.

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| The picker lists no models at all | A `//` comment inside the `!!js` scalar commented out the expression's `return`, so `providers` evaluated to `undefined` | Remove the comments; keep the rationale in the `#` comments above the row |
| The route is missing while other routes work | The credential is empty in the deployment environment, so the guarded spread adds nothing | Add the key to the environment file and restart the deployment |
| The key authenticates but every turn fails | The key belongs to the vendor's other service, or the plan has no balance | Check the key against the plan's own endpoint before wiring it |
| A model from the plan is absent from the picker | The installed catalog predates it | Restate the route's `models` list |
| The route reaches the wrong region | The catalog host is the China endpoint | Pin `baseURL` to the international host |
