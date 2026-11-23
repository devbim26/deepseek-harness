---
kind: upgrade-guide
description: "Preset rows that publish a service must declare an isolate realm, or the preset registry refuses to mount the preset."
---

# Preset rows that publish a service need an isolate realm

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-tool-pdf` publishes the `pdfReports` service, `@deepseek-ai/dsh-tool-present` publishes `fileDeliveries`, and `@deepseek-ai/dsh-agent-orchestrator` publishes `agentOrchestrator`. A preset row that mounts one of these packages must hold the published service in an isolate realm. Without one, the service lands in the root realm, the preset registry refuses to mount the preset, and every session that requests it fails with `agent-preset/invalid: Preset services require isolate realms: <service names>`.

This affects operators whose profile, patch, or overlay declares a preset — an `@deepseek-ai/dsh-agent-preset` row, or a custom agent created through `@deepseek-ai/dsh-agent-preset-custom`. Rows that mount only tool packages without a service keep working unchanged. Custom agents created through the manager are synthesized with the realms already in place.

## Migration

1. Give every preset row that mounts one of these packages an `isolate` map naming the service it publishes:

   ```yaml
   - id: tool-pdf
     name: '@deepseek-ai/dsh-tool-pdf'
     isolate:
       pdfReports: true
   - id: present
     name: '@deepseek-ai/dsh-tool-present'
     isolate:
       fileDeliveries: true
   ```

   The `agentOrchestrator` service of `@deepseek-ai/dsh-agent-orchestrator` takes the same shape.

2. Inside a `cordis:group` that already declares `isolate` for the service, leave the child rows without their own `isolate` map. The group realm covers its children; a child that declares a second realm publishes the service under a symbol the group's other rows cannot see, and the orchestrator engine then finds no report service to write its PDF with.

3. Confirm the migration: the profile boots and its presets appear in the roster without a `broken` marker, `dsh --profile <profile> --dump-config` shows the `isolate` map beside the row, and creating a session succeeds.
