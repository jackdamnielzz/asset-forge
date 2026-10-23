# Asset Forge

Our own asset-creation tool, in the spirit of Blender, built so that **AI models can drive
it completely**, and people can too. See [PLAN.md](PLAN.md) for the vision and roadmap.

**Status:** all 8 phases of the plan are done (foundation, beauty, shapes & generators, games, pixel art & AI services,
AI superpowers, more pixel art, comfort & sharing).

## Starting it

- **As a program:** double-click `Install Asset Forge.bat` once. It puts an **Asset Forge** shortcut with its own icon on
  the desktop and in the Start menu; that opens Asset Forge in its own window (no browser tabs). The engine runs
  invisibly and stops by itself 10 minutes after the last window closes.
- **Quick:** double-click `Start Asset Forge.bat`. The window opens in your browser.
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

## What's in Phase 5

**AI services** (window: **✨ AI**). Paste your own API key under Services; keys stay in `workspace/secrets.json`.

| Service | Makes | Commands |
|---|---|---|
| OpenAI (gpt-image) | images, transparent backgrounds, edits with reference pictures | `generate_image` |
| Google Gemini (Nano Banana 2.1 and others) | images, edits with reference pictures | `generate_image` |
| NanoGPT (many models: Flux, HiDream, gpt-image, Veo, Kling, Wan…) | images, videos | `generate_image`, `generate_video` |
| fal.ai (Trellis 2, Hunyuan 3D) | 3D models from a picture or text | `generate_3d` |
| PixelLab (pixflux, image-to-pixelart) | pixel art from text, or from a picture / your 3D render | `generate_image` |

`generate_image` can also send a render of your own 3D object as reference ("repaint this as pixel art").
AIs that have their own image tools (like PixelLab in Claude Code) can simply `import_image` their results.

**Picture tools** (free): `remove_background`, `make_seamless` (photo → tiling texture), `pixelate_image`
(picture → pixel art), `video_to_sprites`, and `import_model` for any `.glb`.

**Pixel art**
- Palettes: `list_palettes` (pico8, sweetie16, endesga32, db16, gameboy, onebit) or your own colours
- `render_sprites` now has dithering, `outlineStyle: "selout"`, pixel clean-up, `pixelsPerMetre` (same scale for all assets),
  `azimuthOffset` (diamond isometric), several `animations` in one sheet, `maps: ["normal", "emission"]` for Godot 2D lights,
  and `project` to write a Godot **SpriteFrames** `.tres` (ready for AnimatedSprite2D)
- `make_tileset`: seamless pixel tiles where one ground blends into another (16 corner tiles), plus a Godot **TileSet** with terrains
- `make_character`: a jointed character with idle, walk, run, attack and jump, ready for 8-direction sprites
- CLI tip: `node src/cli/forge.js <command> @args.json` reads arguments from a file

## What's in Phase 6

- **Recipes**: everything made by a generator remembers its options (`get_recipe`). `remake` rebuilds it with
  changes in the same place ("same chest, but older and bigger"). `save_recipe` / `use_recipe` store any object,
  hand-built ones too, as a template for other projects.
- **Variations**: `make_variations` builds several versions side by side and returns a picture of them;
  `keep_variation` keeps the best one in the original's place.
- **Quality check**: `check_quality` (✔ Check button) finds floating or loose parts, sinking objects, odd sizes,
  heavy polygon counts, missing pictures and beauty issues, with a score and a fix for each.
- **House styles**: `apply_house_style` gives a whole project one look (palette, light, style, effects) and snaps
  colours to the palette; sprites, tiles and pixel art then use that palette too. Built in: storybook, dark_fantasy,
  retro_pixel. `save_house_style` saves your own.

## What's in Phase 7

- **Pixel editor** (✎ on a library picture): pencil, eraser, fill, colour picker, mirror drawing, frames with onion skin, undo.
  AIs edit pixels with `paint_pixels`.
- **Effects** (`make_effect`, 🎮 Game → Effects): explosion, fire, smoke, magic, sparks, glitter, heal, lightning; looping ones loop seamlessly.
- **Parallax backgrounds** (`make_parallax`): mountains, forest, city, clouds at day, sunset or night, in layers that repeat sideways.
- **Colour tools**: `recolor_image` (swap colours), `make_palette_variants` (a red, green and blue version), `extract_palette`
  ("steal" a palette from any picture, optionally as a house style), `check_pixel_style` (blurry pixels, too many or wrong colours, noise).
- **Sheets**: `make_prop_sheet` (all objects as pixel props, one palette) and `make_iso_tiles` (a level kit as 2:1 isometric tiles).
- **Aseprite**: `export_aseprite` turns any sprite sheet into an `.aseprite` file with a tag per animation row.
- **Voxels**: a `voxels` object type (3D pixels) with build mode in the window (click to add, Shift to remove, Alt to paint),
  `edit_voxels`, `voxels_from_image` (pixel sprite → 3D blocks) and `import_vox` (MagicaVoxel).
- **PixelLab** joins the AI services: `generate_image { service: "pixellab" }` (pixflux, or image-to-pixelart with a reference).

## What's in Phase 8

- **Size reference**: the 🧍 button shows a see-through 1.8 m person; `render_preview { sizeReference: true }` for AIs.
- **Asset library** (📚 Library): `save_asset` stores an object with a thumbnail, tags and description; `search_library`
  finds assets, images and models by words or tags; `place_asset`, `tag_item`, `delete_library_item`.
- **Windows program**: icon (`assets/icon.ico`, made by `scripts/make-icon.js`), app window, shortcuts (`Install Asset Forge.bat`).
- **Sharing**: `Share Asset Forge.bat` asks for a password and opens Asset Forge to your local network. Others log in in their
  browser; AIs elsewhere use `FORGE_URL=http://<address>:7777` and `FORGE_PASSWORD=<password>` with the MCP server or CLI.
  Other computers cannot read or write files on this PC by path, nor change AI service settings. Windows may ask once
  whether Node.js may use the network. For friends outside your home network, use a tunnel service (e.g. Tailscale).
- **Safety**: requests from other websites (CSRF) and unknown host names (DNS rebinding) are now refused, also without sharing.

## After the plan

- **Tested in real Godot 4.6**: `npm run test:godot` exports a chest (collision + animation), level-kit pieces,
  character sprites, a tileset and an effect into a temporary Godot project and lets Godot import and check them.
- **Version history**: every project keeps earlier versions (automatically every few minutes, before big changes, and
  checkpoints you make yourself). Projects → "Earlier versions" to go back; `list_versions`, `save_checkpoint`, `restore_version`.
- **Backups**: once a day a dated copy of all projects, the library and the history goes to `workspace-backups/`
  (last 7 kept); `backup_now { to }` copies everything to another folder, e.g. a USB stick.
- **PixelLab in full** (✨ AI → PixelLab): every PixelLab tool (70+: images, characters in 4/8 directions, animations,
  tilesets, isometric tiles, UI, fonts, effects, editing) with **all** of its settings, read live from PixelLab's own
  specification, so new PixelLab features appear automatically. The window builds a form per tool; long jobs are followed
  until done and every resulting picture lands in the library. Commands: `pixellab_tools`, `pixellab_tool_info`,
  `pixellab_run`, `pixellab_balance`.
- **Multi-select**: Ctrl+click (in the 3D view or the object list) selects several objects; group them (Ctrl+G),
  give them a material or colour, duplicate or delete them at once. `group_objects` / `ungroup` keep everything in place.

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
