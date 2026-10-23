# Asset Forge

Our own asset-creation tool, in the spirit of Blender, built so that **AI models can drive
it completely**, and people can too. See [PLAN.md](PLAN.md) for the vision and roadmap.

**Status:** Phases 1 (Foundation), 2 (Beauty), 3 (Shapes & generators) and 4 (Made for our games) are done.

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

## What's in Phase 2

- Soft corner shadows (ambient occlusion) and real glow (bloom), switchable with `set_effects`
- Styles for the whole scene with `set_style`: realistic, toon (with outlines), low-poly, clay
- Generated materials, made by code and seamless: wood, planks, brushed and scratched metal,
  rust, stone, brick, tiles, fabric, concrete, hand-painted. They are sized in real metres,
  so they never stretch, and they export into the GLB as normal textures.
- "Age" (`wear` 0–1): grime, scratches, faded colour and darker worn edges on rounded boxes
- 13 new material presets that use these (oak, old_wood, rusty_metal, brick_wall, cobblestone…)
- Try it: `node src/cli/forge.js run examples/showcase.json`

## What's in Phase 3

- New shape types: **spin** (`lathe`, a profile spun around: bottles, vases, barrels), **outline**
  (`extrude`, a flat outline with depth: blades, signs), **3D text**, **rock**, and **picture → 3D**
  (`cutout`: the outline of an imported picture as a solid shape, picture on the front)
- `cut_object`: cut one shape out of another (holes, windows, keyholes, grooves), melt them together, or keep the overlap
- `mirror_object` (symmetry) and `repeat_object` (in a line, a circle or a grid)
- Generator library (`plugins/props`): barrel, chest (open or closed, with treasure), rock (boulder,
  cluster, pebbles, with moss), tree (round, pine, dead), crystal, potion (3 bottle shapes), sword,
  coin (with symbol, stacks), lamp post, fence. Each has options and a seed for endless variations.
- Generated textures are exported as JPEG, so GLB files stay small
- Try it: `node src/cli/forge.js run examples/generators.json`

## What's in Phase 4

- **Animations**: `animate_object` with presets (spin, bob, pulse, swing, hinge, shake, hop) that can be
  combined, or `set_keyframes` for custom movement. Play them with ▶ in the window. They are baked into GLB
  exports, so Godot gets an AnimationPlayer.
- **Sprite sheets**: `render_sprites` photographs an object from 1, 4 or 8 directions and every animation
  frame, as crisp pixel art with a shared palette and outline (or smooth HD). A `.json` file describes the layout.
- **Icons**: `make_icons` makes matching inventory icons (same angle, light, outline) for every object at once.
- **Godot**: `export_godot` writes a `.glb` straight into a Godot 4 project with a collision shape
  (`-colonly` / `-convcolonly` import hints) and animations; `export_each` exports every object or kit piece separately.
- **Level kits**: `make_level_kit` (dungeon, cottage, scifi) builds floor, wall, door, window, pillar and stairs pieces on a grid.
- **Snapping**: the small selector under the move/rotate/scale buttons snaps to a grid and to 15° turns.
- Everything is in the new **🎮 Game** window too.

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
