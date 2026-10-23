# Asset Forge

Our own asset-creation tool, in the spirit of Blender, built so that **AI models can drive
it completely**, and people can too. See [PLAN.md](PLAN.md) for the vision and roadmap.

**Status:** Phase 1 (Foundation) is done.

## Starting it

- **Easiest:** double-click `Start Asset Forge.bat`. The window opens in your browser.
- **Terminal:** `npm start` (opens the window) or `node src/server/index.js --no-open`.
- **Claude Code:** just ask Claude, in this folder, to build something. The engine starts by itself.

The window lives at <http://127.0.0.1:7777>. Everything is saved automatically.

## What's in Phase 1

- 3D window: orbit camera, click to select, move/rotate/scale handles, undo/redo
- Shapes: box (with rounded edges), sphere, cylinder, cone, torus, plane, capsule, groups
- Your own pictures: drop them in, place them as flat pictures or paint them on shapes
- 13 material presets (steel, gold, wood, glass, glow…) plus full manual control
- 6 lighting presets (studio, product, outdoor, sunset, night, dramatic) with soft shadows
- Render pictures (up to 4096 px, transparent background optional)
- Export `.glb` 3D models (open in Godot, Unity, Unreal, Blender)
- Projects that save after every change
- Example plugin: `make_crate`, a wooden crate generator

## How AIs control it

Every action is a **command**. The window's buttons, the MCP tools, the HTTP API and the CLI
all use the same command list, so anything one of them can do, the others can too.

| Who | How |
|---|---|
| Claude Code (in this folder) | Automatic via `.mcp.json` |
| Claude Code (anywhere) | `claude mcp add asset-forge -- node D:/Programmeren/asset-forge/src/mcp/index.js` |
| Claude Desktop / Cursor / other MCP apps | Add an MCP server: command `node`, args `D:/Programmeren/asset-forge/src/mcp/index.js` |
| Any other AI, script or language | HTTP: `GET /api/commands` lists everything with input schemas; `POST /api/commands/<name>` with JSON runs one |
| Terminal | `node src/cli/forge.js list`, `node src/cli/forge.js add_object type=box` |

HTTP example:

```bash
curl -X POST http://127.0.0.1:7777/api/commands/add_object -H "Content-Type: application/json" -d "{\"type\":\"sphere\",\"material\":{\"preset\":\"gold\"}}"
```

`render_preview` returns a PNG so an AI can *look* at its work (`?format=png` on HTTP returns the raw image).
Pictures and 3D rendering run in a hidden Chrome/Edge window, so they work even when the
window isn't open.

## Folders

```
src/core/       the engine: scene, commands, history, saving
src/server/     HTTP API, live connection to windows, hidden renderer
src/mcp/        the MCP plug for Claude Code and other AI apps
src/cli/        command-line tool
src/shared/     presets used by both engine and window
web/            the window (three.js)
plugins/        add-ons; each folder is one plugin
workspace/      your projects, image library and exports (not in git)
test/           smoke test: npm test
```

## Writing a plugin

Create `plugins/<name>/index.js`:

```js
export const description = 'What it does';
export default function register({ registry, z, engine }) {
  registry.define({
    name: 'my_command',
    description: 'Explain it for humans and AIs',
    input: z.object({ size: z.number().optional() }),
    async handler(args, ctx) {
      return engine.execute('add_object', { type: 'box', params: { width: args.size ?? 1 } }, ctx.meta);
    },
  });
}
```

Restart the engine and the command appears in the window's API, the MCP tools and the CLI.
See `plugins/crate` for a full example.
