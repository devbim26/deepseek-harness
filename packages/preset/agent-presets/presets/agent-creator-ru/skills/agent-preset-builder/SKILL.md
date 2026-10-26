---
name: agent-preset-builder
description: Use when the user wants to create, edit, duplicate, package, validate, or explain DeepSeek Harness agents and agent presets; mentions "новый мод", "пресет", "agent preset", "агенты внутри пресета", "agent.cordis.yml", "добавить tool/plugin", "сделай режим", or asks to form several agents/tools into a selectable preset.
---

# Agent preset builder

This skill helps create and maintain DeepSeek Harness agent presets. A preset is a directory containing an `agent.cordis.yml` composition plus optional `preset.yml` metadata and optional preset-local skills/assets. The preset defines one session agent's persona, tools, prompt sections, skills, compaction, delegation, and workflows.

## When to use

Use this skill whenever the user asks to:

- create a new mode/preset/mod for DeepSeek Harness;
- add, remove, or edit tools/plugins inside a preset;
- duplicate Standard/Minimal/PTC/Creator mode and customize it;
- make a specialized coding/BIM/web/research/read-only/full-access agent;
- bundle several capabilities or local skills into a reusable preset;
- diagnose why a preset is not visible, broken, or missing tools.

If available, also load `editing-cordis-compositions` for detailed Cordis rules before editing `agent.cordis.yml`.

## Core concepts

- A **preset** is not a single prompt. It is a Cordis composition: a list of plugin rows.
- Each row has:
  - `id`: local unique row id inside the composition;
  - `name`: package/plugin name, for example `@deepseek-ai/dsh-tool-web`;
  - optional `config`: plugin configuration;
  - optional `disabled`: boolean or JS expression;
  - optional `group`/`isolate`: used when a preset-owned service must be private to each mounted session.
- `preset.yml` controls roster display:
  - `name`: visible preset name;
  - `description`: one-sentence explanation;
  - `order`: sort order, usually only for shipped presets.
- `agent.cordis.yml` controls actual behavior.

## Preferred authoring workflow

1. **Clarify the desired agent** if the user did not specify enough:
   - display name and id;
   - main tasks/persona;
   - required tools: filesystem, shell, web, skills, goals, plan mode, subagents, workflows, Ralph;
   - safety level: read-only, workspace-write, full coding;
   - whether custom preset-local skills should be included.

2. **Choose a base preset**:
   - `standard`: best default for full coding agent;
   - `minimal`: persistent shell only;
   - `ptc`: full agent without workflow tool, tools exposed through PTC SDK;
   - `cordis`: creator mode, good for preset/plugin authoring.

3. **Create a user preset directory**.
   Prefer the user preset root if known, usually:
   - `${DSH_HOME:-$HOME/.dsh}/.agent-presets/<preset-id>/`

   If the user explicitly asks for a test in the checkout, use the shipped preset tree only if they understand it may be overwritten by updates. Better: create under the workspace or user root and explain how to install.

4. **Copy from the base** instead of writing from scratch when possible.
   A copied `agent.cordis.yml` starts loadable and preserves required realms/groups.

5. **Edit metadata** in `preset.yml`.

6. **Edit composition** in `agent.cordis.yml`:
   - change persona text in the `@deepseek-ai/dsh-persona` row;
   - remove or disable unwanted tool rows;
   - keep related provider/consumer rows together;
   - do not move host-plane registries into a preset;
   - isolate preset-owned services with `cordis:group` and `isolate`.

7. **Add preset-local skills** if needed:
   - create `skills/<skill-name>/SKILL.md` inside the preset directory;
   - use frontmatter with `name` and `description`;
   - write operational instructions;
   - keep them narrow and triggerable.

8. **Validate**:
   - YAML parses;
   - required files exist: `preset.yml`, `agent.cordis.yml`;
   - preset id matches `[a-z0-9][a-z0-9-]*`;
   - no duplicate row ids;
   - after restart or live validation, the preset appears in the roster;
   - start a new session with the preset and confirm tools/skills.

## Common row patterns

### Persona

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are a coding agent specialized in <domain>, powered by the {{model}} model.
```

### Filesystem tools

```yaml
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false
```

### PowerShell/Bash tools

```yaml
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'
```

To disable shell completely:

```yaml
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: true

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: true
```

### Skills

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
```

### Web search/fetch

```yaml
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
    searchTimeoutMs: 60000
```

### Todo, ask-user, present

```yaml
- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: present
  name: '@deepseek-ai/dsh-tool-present'
```

### Goals

```yaml
- id: command-goal
  name: '@deepseek-ai/dsh-command-goal'

- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'
```

### Subagents and workflows

Use the `standard` preset as the source of truth for the full delegation block. Do not reconstruct it from memory unless necessary; copy the whole `delegation` group, because workflow provider and tool rows must share the same isolated realm.

## Preset archetypes

### Full coding agent

Start from `standard`. Keep filesystem, shell, web, skills, goals, plan mode, jobs, subagents, workflows, todo, ask-user, present.

### Read-only analyst

Start from `standard`, then disable shell and omit mutation-heavy instructions. Note: tool availability does not by itself enforce sandbox policy; the runtime file policy controls actual write permission. For strong read-only behavior, configure session permissions as read-only too.

### Web researcher

Keep web, todo, ask-user, present, maybe filesystem read/search. Disable shell and subagents if not needed.

### Preset/plugin author

Start from `cordis`. Keep Cordis inspection/editing skills and full coding tools. Add this skill as preset-local if the preset should teach future agents how to build presets.

### Minimal fast helper

Start from `minimal` or write a small composition with persona + only the one required tool. Validate carefully, because from-scratch compositions often miss dependencies.

## Editing rules and pitfalls

- Never edit shipped presets (`standard`, `ptc`, `minimal`, `cordis`) when the goal is a user customization. Copy them.
- Do not add a plugin row unless the package exists in the deployment.
- Do not invent tool package names. Search existing compositions and packages first.
- Do not place service providers loose in a preset. If a row publishes a service that belongs to the preset, wrap provider and consumers in a `cordis:group` with `isolate`.
- Do not isolate rows that only consume host-plane services unless the copied preset already does so.
- Keep `id` values unique.
- Keep preset ids lowercase kebab-case.
- After editing files under the running Harness checkout, a server restart may be required for the roster to refresh.
- Client/plugin HMR does not guarantee preset roster reload; tell the user to refresh/restart when needed.

## Output style when helping the user

When you create or edit a preset, report:

- preset id and display name;
- files changed;
- enabled/disabled major capabilities;
- how to make it appear in GUI: usually restart Harness and refresh `http://127.0.0.1:3080`;
- how to test: create a new session with that preset and ask it to list available tools/skills.

## Minimal template

`preset.yml`:

```yaml
name: My Agent Mode
description: Short explanation of this custom agent preset.
```

`agent.cordis.yml`:

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are a specialized agent powered by the {{model}} model.

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'

- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true
```

Prefer copying `standard` for production presets; use the minimal template only for simple experiments.
