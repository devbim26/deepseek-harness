# Headless Office Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount the existing built-in Office/document stack (`office-kit`, `tool-office`, `skill-office`) plus final file delivery (`tool-present`) into the headless one-shot bundle, so `dsh --profile headless "task"` can create Excel/Word/PowerPoint files, convert them to PDF, and deliver them as final deliverables.

**Architecture:** No new packages. The Web (`packages/bundle/web-app/cordis.patch.yml:291-313`, `presets/standard.patch.yml:129-131`) and SDK (`packages/bundle/sdk-app/cordis.patch.yml:36-52,80-84`) bundles already mount this stack; the headless bundle patch gains the same rows. Headless differences from SDK: no `workspace-dependencies` bundled Python runtime (the skill points at the user's Python), and no `deliverable-file-references`/`file-reference-local` (those add link-rendering guidance for hosts with a GUI; headless prints text and the final answer can name paths directly).

**Tech Stack:** Cordis bundle patches (YAML with `!!js` config expressions), pnpm workspace dependencies, bilingual README pairing, generated catalogs, keyless recorded-session snapshot refresh.

**Approved design (user-approved 2026-11-14):** reuse the built-in stack; mount into headless; no new plugin.

## Global Constraints

- Branch: `webUI`. Do not push; commit locally only.
- Repo root: `C:\Users\Lenovo\Desktop\проект SOFT_2\Models FIN\Harness`. Run all commands from the repo root (Git Bash).
- No TypeScript source changes planned; if any test helper TS changes, per-file 100% coverage applies (`packages/*/*/src`).
- Bundle dependency sections use DSH `workspace:*` (mirror `packages/bundle/sdk-app/package.json`, which lists these packages under plain `dependencies`, not `peerDependencies`).
- `cordis.yml` allows `!!js` (never `!js`) under `config` and entry `disabled`.
- `skill-office` must set `pythonEnvironment: 'user'` explicitly: its default is `'workspace-dependencies'` (`packages/skill/skill-office/src/index.ts:42`), a Desktop-only bundled runtime headless never has.
- Bare plugin names in a bundle patch must appear in that bundle's `package.json` `dependencies` (`verify-cordis-config` resolver manifest = `apps/cli/package.json` + every `packages/bundle/*/package.json`).
- Keep the headless bundle's boundary: no Host, HTTP server, Web runtime, browser, or UI deliverable-card plugins.
- READMEs are bilingual pairs recorded via `pnpm run verify-translation-pairing --write <path>/README.md`; English copy in sentence case; one physical line per paragraph.
- Files end with exactly one trailing newline.
- `DEEPSEEK_API_KEY` is not available locally: real-API smoke is out of scope for local verification; note it for the user.

---

### Task 1: Mount the Office stack and `present` in the headless bundle

**Files:**
- Modify: `packages/bundle/headless/cordis.patch.yml` (inside the existing `- insert:` block, after the `headless-runner` row)
- Modify: `packages/bundle/headless/package.json` (`dependencies` section)

**Interfaces:**
- Consumes: base bundle services (`tools`, `fs`, `workingDirectory`, `skills`, `agents`, boot-provided `dshHomePath`).
- Produces: headless profile with `office_render` / `office_convert` / `office_recalculate` tools, `office` + `office-docx` / `office-xlsx` / `office-pptx` skills, and the `present` deliverable tool.

- [ ] **Step 1: Add the four plugin rows to `packages/bundle/headless/cordis.patch.yml`**

Inside the existing `- insert:` block, after the `headless-runner` entry, add:

```yaml
    # One-shot document tasks: Office authoring skills, LibreOffice-backed
    # render/convert/recalculate tools, and final file delivery through present.
    - id: office-kit
      name: '@deepseek-ai/dsh-office-kit'
      config:
        outputDirectory: !!js dshHomePath('office-kit', 'outputs')

    # The Office tools stay registered without Kit; calls report the service's unavailable error.
    - id: tool-office
      name: '@deepseek-ai/dsh-tool-office'

    - id: skill-office
      name: '@deepseek-ai/dsh-skill-office'
      config:
        pythonEnvironment: 'user'

    - id: present
      name: '@deepseek-ai/dsh-tool-present'
```

(If `insert` rows must stay in one block, keep them contiguous after `headless-runner`.)

- [ ] **Step 2: Add the four workspace dependencies to `packages/bundle/headless/package.json`**

In the `dependencies` object, keeping alphabetical order:

```json
"@deepseek-ai/dsh-office-kit": "workspace:*",
"@deepseek-ai/dsh-skill-office": "workspace:*",
"@deepseek-ai/dsh-tool-office": "workspace:*",
"@deepseek-ai/dsh-tool-present": "workspace:*",
```

- [ ] **Step 3: Link the workspace**

Run: `pnpm install`
Expected: lockfile updates; no resolution errors.

- [ ] **Step 4: Verify composition resolution**

Run: `pnpm run verify-cordis-config`
Expected: PASS (bare names resolvable; `!!js` expressions valid).

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/headless/cordis.patch.yml packages/bundle/headless/package.json pnpm-lock.yaml
git commit -m "feat(headless): mount the office stack and present in the one-shot bundle"
```

### Task 2: Update the headless bundle READMEs

**Files:**
- Modify: `packages/bundle/headless/README.md`
- Modify: `packages/bundle/headless/README.zh.md`
- Modify: `packages/bundle/headless/README.i18n.yaml` (if pair hashes are recorded there)

**Interfaces:**
- Consumes: Task 1's mounted plugins.
- Produces: user-facing documentation of the headless Office/delivery capability.

- [ ] **Step 1: Update `README.md`**

In `## Summary`, state that one-shot tasks can author Office documents through the packaged Office skills (Excel via Python, Word, PowerPoint), convert and render them to PDF/PNG through the LibreOffice-backed Office tools, and declare final files with `present`. Keep the existing "no GUI, no server, no browser" boundary sentence. In `## Use this package`, add one paragraph: files must be written inside the Session workspace (or another path the Session filesystem can access) before `present`; the final answer names the delivered paths. One physical line per paragraph; sentence case; no metaphors.

- [ ] **Step 2: Mirror the same facts in `README.zh.md`**

Translate the changed paragraphs; keep structure identical.

- [ ] **Step 3: Record the translation pairing**

Run: `pnpm run verify-translation-pairing --write packages/bundle/headless/README.md`
Expected: pairing recorded/updated, exit 0.

- [ ] **Step 4: Run the documentation gates**

Run: `pnpm run doc-sync`
Expected: PASS (fix any budget/link findings before committing).

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/headless/README.md packages/bundle/headless/README.zh.md packages/bundle/headless/README.i18n.yaml
git commit -m "docs(headless): document office authoring and present delivery"
```

### Task 3: Regenerate affected catalogs

**Files:**
- Modify: generated catalog files owned by `scripts/gen-official-bundle-catalog.ts`, `scripts/gen-cordis-catalog.ts`, `scripts/gen-dependency-catalog.ts` (whichever report changes)

**Interfaces:**
- Consumes: Task 1's patch and package.json changes.
- Produces: regenerated catalogs matching the new headless composition.

- [ ] **Step 1: Regenerate the official bundle catalog**

Run: `pnpm run gen-official-bundle-catalog`
Expected: the headless bundle's plugin list gains the four rows.

- [ ] **Step 2: Regenerate the remaining catalogs that report drift**

Run in order; stop regenerating when a run reports no diff:
```bash
pnpm run gen-cordis-catalog
pnpm run gen-dependency-catalog
```
Then check the unchanged-by-construction gates:
```bash
pnpm run verify-config-catalog
pnpm run verify-tool-catalog
```
Expected: config/tool catalogs unchanged (no Config schema or tool changes).

- [ ] **Step 3: Commit**

```bash
git add -A ':!pnpm-lock.yaml'
git commit -m "chore: regenerate catalogs for the headless office mount"
```

### Task 4: Refresh headless snapshots and run focused checks

**Files:**
- Modify: `snapshots/session/headless-auto-review/` and `snapshots/session/headless-credentials/` fixtures (header sidecars pin `toolSchemasSource`; the new tools change the schema set)

**Interfaces:**
- Consumes: Task 1's shipped headless profile.
- Produces: keyless replay passing with the enlarged headless tool set.

- [ ] **Step 1: Confirm the replay failure mode**

Run: `pnpm run test:snapshot -t headless`
Expected: FAIL on pinned tool schemas / header mismatch for the headless scenarios (new `office_*` and `present` tools absent from recorded sidecars).

- [ ] **Step 2: Refresh the affected scenarios (keyless)**

Run: `DSH_SNAPSHOT=refresh pnpm run test:snapshot -t headless`
Review every diff; replay input (recorded transcripts) must remain untouched — only header/tool-schema sidecars and normalization may change.

- [ ] **Step 3: Verify replay passes**

Run: `pnpm run test:snapshot -t headless`
Expected: PASS.

- [ ] **Step 4: Run the pre-push gates that match the surface**

Run:
```bash
pnpm run verify-cordis-config
pnpm run doc-sync
```
Expected: PASS. (No TS changed, so `build:check`/`test:coverage` are not required; `hygiene` runs the workspace/dependency checks if dependency ordering is questioned.)

- [ ] **Step 5: Commit**

```bash
git add snapshots/session/headless-auto-review snapshots/session/headless-credentials
git commit -m "test: refresh headless snapshots for the office and present tools"
```

### Out of scope / follow-up

- Real-API smoke (`pnpm dsh --profile headless "create report.xlsx with sample data, then present it"`): needs `DEEPSEEK_API_KEY`; run when a key is available or rely on CI e2e.
- Office/PDF output rendering in headless: the one-shot JSON stream (`--json`) carries tool/deliverable events; no extra work planned.
