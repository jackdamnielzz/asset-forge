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
- Animations (`scene.animations`) are presets/keyframes giving offsets from an object's pose, defined in
  `src/shared/animations.js` and sampled by the viewer (`SceneView.pose`). Sprite sheets, icons and Godot export
  are bridge requests handled in viewer.js (`renderSprites`, `renderImage` with `isolate`, `exportGlb` with
  `collision`/`animations`); 2D clean-up (palette, outlines) lives in `web/js/pixelart.js`.
- AI services live in `src/core/providers.js` (OpenAI, Google, NanoGPT, fal). Keys: `workspace/secrets.json` or env vars;
  never return keys from commands. `test/mock-ai.js` imitates their APIs for `npm test`; real calls are untested without keys.
  These services cost the user money: ask before calling generate_image / generate_video / generate_3d.
- Pixel-art pipeline: `web/js/pixelart.js` (palette, dither, selout, clean-up), `web/js/imageops.js` (picture tools, video frames),
  `web/js/tileset.js` + `src/core/commands/tiles.js` (corner autotiles, Godot TileSet). Palettes: `src/shared/palettes.js`.
- Generators get a `recipe` automatically (set in `Engine.execute` for category "generators"). Recipes, variations,
  quality check and house styles are in `src/core/commands/superpowers.js`; the quality check measures via the
  `inspect` bridge request. Saved recipes/styles live in `workspace/library/recipes|styles/`.
- Phase 7: 2D effects and parallax in `web/js/fx2d.js`, pixel editor `web/js/pixeleditor.js` (saves via import_image),
  voxel mesh + click picking `web/js/voxels.js`, `.vox` reader `src/core/vox.js`, Aseprite writer `src/core/aseprite.js`,
  commands in `src/core/commands/pixel2d.js` and `voxels.js`. Picture operations go through the `image_op` bridge request.
- Access control lives in `src/server/access.js`: same-origin + Host checks on every request and WebSocket upgrade,
  password (cookie session or Bearer) for non-local callers when sharing (`FORGE_HOST`, `FORGE_PASSWORD`), and no
  path/project arguments or AI-key changes from other computers. `FORGE_TRUST_LOCAL=0` makes local callers log in (tests).
- Windows launcher: `scripts/launch.ps1` (hidden engine with `--idle-exit=10`, Edge/Chrome `--app` window),
  `scripts/install-shortcuts.ps1`, icon from `scripts/make-icon.js`. Asset library: `src/core/commands/library.js`.
- For development, run a second engine (`FORGE_PORT=7791`, `FORGE_WORKSPACE` in a temp folder) so the user's
  window on 7777 is not disturbed.

## Making assets with the MCP tools
The `asset-forge` MCP server is configured in `.mcp.json`. Build with several parts in a group,
keep box bevels > 0, use material presets then tune, and **always check with render_preview**
before saying something is done. Exports go to `workspace/exports/`.

## Checks
- `npm test` runs an end-to-end smoke test (starts a private engine on port 7790).
- `npm run test:godot` checks the exports inside real Godot 4 (finds Godot automatically, or set GODOT).
- Version history lives in `src/core/history.js` (workspace/history/<project>/); test engines set FORGE_NO_BACKUP=1
  so they do not make daily backups next to their temp workspace.
- Engine for manual testing: `node src/server/index.js --no-open` → http://127.0.0.1:7777
