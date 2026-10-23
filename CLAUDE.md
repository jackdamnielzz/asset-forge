# Asset Forge: notes for AI assistants

The user is not a developer and wants every reply in English, in plain language.

## The product
An AI-controllable 3D asset tool (see PLAN.md). Priorities: 1) beautiful output, 2) full AI control, 3) expandability.

## Architecture rules
- **Command-first:** every feature is a command in the registry (`src/core/commands/*` or a plugin).
  The window must only call commands (`POST /api/commands/<name>`); never add UI-only behaviour.
- The engine (Node) owns the scene JSON; it never draws. Drawing (render/export) happens in
  `web/js/viewer.js`, run by a hidden headless browser (`?role=renderer`) or an open window.
- Shared constants live in `src/shared/presets.js` (imported by both Node and browser, no imports allowed there).
- Plain modern JavaScript (ES modules), no build step. three.js is served from node_modules via an import map.
- Command inputs use zod; descriptions are read by AIs, so write them as instructions.
- Generated materials live in `web/js/patterns.js` (seamless noise, 512px canvases, cached per settings);
  picture effects in `web/js/effects.js`. Effects tone-map the whole frame, so the background colour is
  compensated there; keep that in mind when touching backgrounds.
- Patterns need metre-based UVs, built in `metricUVs()` in viewer.js; geometry keys must include anything that changes UVs.
- Advanced shapes live in `web/js/shapes.js`. Text fonts and cut-out outlines load asynchronously via
  `SceneView.resourceFor()`; the scene rebuilds when they arrive.
- Cut/combine (`booleans` on an object) uses three-bvh-csg 0.0.17 (newer versions need three ≥ 0.179).
  Create a fresh `Evaluator` per operation; it keeps attribute settings between runs.
- Undo: the outermost command or batch takes one snapshot (`Engine.recorded`, AsyncLocalStorage);
  nested commands inside it are part of the same step. Concurrent callers are queued.
- Generators are plugins in `plugins/props/` built with `defineGenerator()` from `kit.js`.

## Making assets with the MCP tools
The `asset-forge` MCP server is configured in `.mcp.json`. Build with several parts in a group,
keep box bevels > 0, use material presets then tune, and **always check with render_preview**
before saying something is done. Exports go to `workspace/exports/`.

## Checks
- `npm test` runs an end-to-end smoke test (starts a private engine on port 7790).
- Engine for manual testing: `node src/server/index.js --no-open` → http://127.0.0.1:7777
