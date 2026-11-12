# Agent Note: devBIM layer on dsh 0.2.2-rc.2

Status: implemented

## Problem

The devBIM history was a commit layer over the snapshot `4cfefd43` (content of fork master `aa8262e`), 10 394 commits behind upstream `deepseek-ai/deepseek-harness` master. Upstream 0.2.2-rc.2 ships a native Excel document preview, solution-only client-face TypeScript projects, the directory-relative token-exchange redirect in `Connection.authorizeIndex`, and requires `node >=24.9.0`. Staying on the snapshot would fork the base permanently and strand every future upstream fix.

## Decision

Branch `internet-rebase-0.2.2` replays the seven devBIM commits onto upstream master `e8f7b93a` (release 0.2.2-rc.2); the snapshot commit is dropped. Local `master` and `internet` keep the pre-rebase history until this branch is validated, and the fork on GitHub is left untouched.

Conflict resolutions: the devBIM favicon and manifest identity win the brand seats, with the upstream-added `background_color` and `theme_color` kept; `packages/bundle/web-app/package.json` takes the upstream dependency list plus `dsh-client-ui-brand-devbim`, `dsh-host-devbim-auth`, and `dsh-mcp-client` (the upstream package now lives at `packages/mcp/mcp-client`); `pnpm-lock.yaml` follows the upstream file with regenerated workspace importers; the slot catalog keeps the upstream `declaredBy` wording with the devBIM `DevBimHeroMark` occupant; `.gitignore` unions the upstream CUA record entry with `.mimosa/`.

Upstream's Excel preview claims `.xlsx`, and its `apply.client.spec.ts` forbids a later body from claiming an earlier body's extension. `XLSX_EXTENSIONS` narrows to `['xlsm']`, so the devBIM xlsx body serves only `.xlsm`; deleting the devBIM `xlsx/` module is the alternative if `.xlsm` support is not needed.

API alignment: the token-exchange test expectation and the devbim-auth source comment follow the new directory-relative `./` redirect; `WebServer.port` is `number | undefined` before binding, so the spec narrows through a `boundPort` helper; `ui-brand-devbim/tsconfig.json` references `../ui-conversation/tsconfig.client.json` because upstream package roots became solution-only configs with face leaf configs; `XlsxBody` wraps upstream's `LoadingIndicator`, whose props dropped `className`.

`document-preview-license-bundle.client.spec.ts` sets an explicit 120 s test timeout. The test propagates `task.timeout` into the `spawnSync` call for `pnpm pack`; packing 374 files takes about 30 s on the devBIM Windows machine, and the previous default 5 s aborted the child before any assertion ran.

## Toolchain

Upstream `engines` requires `node >=24.9.0`: the tsdown client bundle pass loads `tsdown.config.ts` through Node type stripping (`--config-loader native`), which Node 22.17 cannot do, so `pnpm run build` cannot complete on the previous local Node. A portable Node 24.22.3 at `C:\Users\Lenovo\node24-portable\` runs builds and tests through a `PATH` override; installing Node 24 as the permanent local Node is the follow-up.
