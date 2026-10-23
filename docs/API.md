# Asset Forge API reference

Version 0.1.0 · 107 commands · generated from the software itself (`npm run docs`), so it always matches.

## How to call

HOW TO CALL
- List everything: GET /api/commands (each command with description and JSON input schema).
- Run a command: POST /api/commands/<name> with a JSON body of its inputs.
  Answer: { "ok": true, "result": … } or { "ok": false, "error": "…" } (HTTP 400 for a wrong input, with a helpful message).
- Pictures: results with "image" hold a base64 PNG. Add ?format=png to get the PNG itself (e.g. render_preview).
- The scene: GET /api/scene. The library: GET /api/library.
- On the same computer no password is needed. When Asset Forge is shared on a network, send
  "Authorization: Bearer <password>" with every request. Callers on other computers cannot use file paths
  (path, project, to); send data or url instead.
- Browsers: requests from other websites are refused; tools and scripts (no Origin header) work.
- MCP: run "node src/mcp/index.js" (or set FORGE_URL and FORGE_PASSWORD to reach a shared Asset Forge) to get every
  command as an MCP tool.

Example:

```bash
curl -X POST http://127.0.0.1:7777/api/commands/add_object -H "Content-Type: application/json" -d '{"type":"box","material":{"preset":"oak"}}'
```

## Guide for AIs

```text
Asset Forge is a 3D and pixel-art asset creation tool that AIs drive completely through commands.
A person may be watching the window live while you work.

BASICS
- Units are metres, Y is up, rotations are in degrees. New objects rest on the ground unless given a position.
- Every action is a command. Call get_scene first to see what exists (objects have ids like "box_1").
- Every changing command is one undo step; run_batch runs many commands as one step ($N.id refers to the id from step N).
- Projects save automatically. save_checkpoint before risky experiments; restore_version goes back.

MAKING BEAUTIFUL 3D ASSETS
1. Build from several well-proportioned parts and put them in a group (add_object type "group", then parent, or group_objects).
2. Keep a small bevel (0.01–0.05) on boxes: rounded edges catch light and look real.
3. Use material presets, then tune colour and roughness. Presets with generated surfaces (oak, floor_planks, old_wood,
   brushed_steel, worn_metal, rusty_metal, cobblestone, brick_wall, floor_tiles, cloth, concrete, hand_painted) look far
   richer than plain colours. Tune with set_material pattern { scale, seed, variation, bump, angle } and wear (age 0–1).
   Avoid pure black and white.
4. Light it: set_environment (studio to judge shapes; outdoor, sunset, night, dramatic for mood). set_style switches the whole
   look (realistic, toon, lowpoly, clay). set_effects controls soft shadows and glow.
5. Generators build whole props in one call, each with options and a seed: make_crate, make_barrel, make_chest, make_rock,
   make_tree, make_crystal, make_potion, make_sword, make_coin, make_lamp_post, make_fence, make_level_kit, make_character.
   remake changes a generator-made object's options in place; make_variations shows several versions (keep_variation picks one).
6. Advanced shapes: lathe (spin a [radius, y] profile: bottles, vases, columns), extrude (flat outline with depth: blades,
   signs), text, rock, cutout (a picture's outline as a solid), voxels (blocks), model (imported .glb).
   Modelling: cut_object (subtract, union, intersect), mirror_object, repeat_object (line, circle, grid), group_objects, ungroup.
7. ALWAYS look at your work with render_preview (it returns a picture; try views iso and front; sizeReference shows a
   1.8 m person) and fix gaps, floating parts and proportions. check_quality finds problems automatically.

GAMES
- Animation: animate_object (spin, bob, pulse, swing, hinge, shake, hop) or set_keyframes. Animations go into exports.
- Godot: export_godot / export_each write .glb files with collision and animations straight into a Godot 4 project.
- Sprites: render_sprites turns an object into a sprite sheet (directions × frames), with pixel-art options (palette,
  dither, outlineStyle "selout", maps ["normal"]) and a Godot SpriteFrames file when a project is given.
- Also: make_icons (inventory icons), make_tileset (autotiles + Godot TileSet), make_effect (explosion, fire, smoke,
  magic, sparks, glitter, heal, lightning), make_parallax (scrolling backgrounds), make_prop_sheet, make_iso_tiles.

PIXEL ART AND PICTURES
- pixelate_image (any picture → pixel art), paint_pixels, recolor_image, make_palette_variants, extract_palette,
  check_pixel_style, remove_background, make_seamless (photo → tiling texture), export_aseprite, voxels_from_image.
- Palettes: list_palettes (pico8, sweetie16, endesga32, db16, gameboy, onebit). apply_house_style keeps a game consistent.

AI SERVICES (cost the user money: ask before calling)
- generate_image (openai, google Nano Banana, nanogpt, pixellab), generate_video (nanogpt), generate_3d (fal).
- PixelLab in full: pixellab_tools lists 70+ tools, pixellab_tool_info shows every setting, pixellab_run runs one.
  pixellab_balance and list_ai_services are free.
- If you have your own image tools, make the picture there and bring it in with import_image (data or url).

DELIVERING
- export_glb (3D model), export_png (picture), save_asset (library with thumbnail and tags). Files go to workspace/exports
  unless a Godot project folder is given.
```

## Contents

- **Scene**: [get_scene](#get_scene), [clear_scene](#clear_scene), [set_environment](#set_environment), [set_style](#set_style), [set_effects](#set_effects), [set_camera](#set_camera), [load_scene](#load_scene), [undo](#undo), [redo](#redo), [run_batch](#run_batch)
- **Objects**: [add_object](#add_object), [update_object](#update_object), [set_material](#set_material), [delete_object](#delete_object), [duplicate_object](#duplicate_object), [get_object](#get_object)
- **Modelling**: [cut_object](#cut_object), [uncut_object](#uncut_object), [group_objects](#group_objects), [ungroup](#ungroup), [repeat_object](#repeat_object), [mirror_object](#mirror_object)
- **Animation**: [animate_object](#animate_object), [set_keyframes](#set_keyframes), [set_animation](#set_animation), [remove_animation](#remove_animation), [list_animations](#list_animations)
- **Pictures & exports**: [render_preview](#render_preview), [export_png](#export_png), [export_glb](#export_glb)
- **Game assets**: [make_icons](#make_icons), [render_sprites](#render_sprites), [export_godot](#export_godot), [export_each](#export_each), [make_tileset](#make_tileset)
- **Generators**: [make_crate](#make_crate), [make_barrel](#make_barrel), [make_chest](#make_chest), [make_rock](#make_rock), [make_tree](#make_tree), [make_crystal](#make_crystal), [make_potion](#make_potion), [make_sword](#make_sword), [make_coin](#make_coin), [make_lamp_post](#make_lamp_post), [make_fence](#make_fence), [make_level_kit](#make_level_kit), [make_character](#make_character)
- **Pixel art**: [make_effect](#make_effect), [make_parallax](#make_parallax), [recolor_image](#recolor_image), [make_palette_variants](#make_palette_variants), [extract_palette](#extract_palette), [check_pixel_style](#check_pixel_style), [paint_pixels](#paint_pixels), [export_aseprite](#export_aseprite), [make_prop_sheet](#make_prop_sheet), [make_iso_tiles](#make_iso_tiles)
- **Picture tools**: [list_palettes](#list_palettes), [remove_background](#remove_background), [make_seamless](#make_seamless), [pixelate_image](#pixelate_image), [video_to_sprites](#video_to_sprites)
- **Voxels**: [edit_voxels](#edit_voxels), [voxels_from_image](#voxels_from_image), [import_vox](#import_vox)
- **Library: importing**: [import_image](#import_image), [import_model](#import_model), [list_images](#list_images), [list_library](#list_library)
- **Library**: [save_asset](#save_asset), [place_asset](#place_asset), [tag_item](#tag_item), [search_library](#search_library), [delete_library_item](#delete_library_item)
- **Recipes, variations & quality**: [get_recipe](#get_recipe), [remake](#remake), [save_recipe](#save_recipe), [use_recipe](#use_recipe), [list_recipes](#list_recipes), [make_variations](#make_variations), [keep_variation](#keep_variation), [check_quality](#check_quality)
- **House styles**: [list_house_styles](#list_house_styles), [save_house_style](#save_house_style), [apply_house_style](#apply_house_style)
- **AI services**: [list_ai_services](#list_ai_services), [connect_ai_service](#connect_ai_service), [generate_image](#generate_image), [generate_video](#generate_video), [generate_3d](#generate_3d)
- **PixelLab (all tools)**: [pixellab_tools](#pixellab_tools), [pixellab_tool_info](#pixellab_tool_info), [pixellab_run](#pixellab_run), [pixellab_balance](#pixellab_balance)
- **Projects, versions & backups**: [list_projects](#list_projects), [new_project](#new_project), [open_project](#open_project), [save_project_as](#save_project_as), [list_versions](#list_versions), [save_checkpoint](#save_checkpoint), [restore_version](#restore_version), [backup_now](#backup_now)
- **Help**: [list_commands](#list_commands), [list_presets](#list_presets), [list_plugins](#list_plugins), [open_window](#open_window)

## Scene

### get_scene

**Get scene**

Return the whole scene: all objects (ids, transforms, params, materials), environment and camera. Call this first to see what exists.

_No inputs._

```json
POST /api/commands/get_scene
{}
```

### clear_scene

**Clear scene** · changes the scene (one undo step)

Remove all objects. Keeps the project name and environment. A version is saved first (see list_versions).

_No inputs._

```json
POST /api/commands/clear_scene
{}
```

### set_environment

**Set lighting & background** · changes the scene (one undo step)

Choose a lighting preset and background. Presets: studio (Neutral soft studio light. Best default for judging shape and material.) product (Bright clean white backdrop, like a webshop product photo.) outdoor (Daylight: blue sky and a warm sun.) sunset (Low orange sun with purple shadows. Warm and cinematic.) night (Cool blue moonlight with a bright rim. Moody.) dramatic (One hard key light and a strong rim on a dark background.)

| Input | Type | Required | Description |
|---|---|---|---|
| `lighting` | one of |  | Lighting preset (descriptions above) Allowed: "studio", "product", "outdoor", "sunset", "night", "dramatic". |
| `exposure` | number |  | Overall brightness, 1 = normal Range 0.1 to 4. |
| `background` | string or null |  | Background colour, "transparent", or null for the preset default |
| `ground` | boolean |  | Show a soft shadow-catching ground |
| `groundColor` | string or null |  | Colour of a solid ground; null for a see-through ground that only catches shadows |

```json
POST /api/commands/set_environment
{}
```

### set_style

**Set style** · changes the scene (one undo step)

Switch the overall look of the whole scene without changing the objects. Styles: realistic (Physically based materials (default)); toon (Cartoon look: flat colour bands and dark outlines); lowpoly (Faceted low-poly look with fewer polygons); clay (Everything in plain grey clay: great for judging shape and proportions). Tip: "clay" is useful to judge shapes; switch back to "realistic" afterwards.

| Input | Type | Required | Description |
|---|---|---|---|
| `style` | one of |  | The look of the whole scene (descriptions above) Allowed: "realistic", "toon", "lowpoly", "clay". |
| `outlineWidth` | number |  | Toon style: outline thickness, 0 = none Range 0 to 5. |
| `outlineColor` | string |  | Toon style: outline colour |
| `toonSteps` | integer |  | Toon style: number of light/shadow bands Range 2 to 6. |

```json
POST /api/commands/set_style
{}
```

### set_effects

**Set picture effects** · changes the scene (one undo step)

Picture effects. ao = soft contact shadows in corners and where objects touch (makes things look grounded). bloom = soft glow around bright and glowing (emissive) parts. Both are on by default.

| Input | Type | Required | Description |
|---|---|---|---|
| `ao` | boolean |  | Soft contact shadows in corners and where objects touch |
| `aoStrength` | number |  | Strength of the soft shadows, 1 = normal Range 0 to 3. |
| `bloom` | boolean |  | Soft glow around bright and glowing parts |
| `bloomStrength` | number |  | Strength of the glow, 1 = strong Range 0 to 3. |
| `bloomThreshold` | number |  | How bright something must be before it glows (default 2.5 = only glowing parts; lower = brightly lit surfaces glow too) Range 0 to 5. |

```json
POST /api/commands/set_effects
{}
```

### set_camera

**Set camera** · changes the scene (one undo step)

Set the scene camera used by the "camera" render view and shown in the window.

| Input | Type | Required | Description |
|---|---|---|---|
| `position` | list of number |  | Camera position [x, y, z] Exactly 3 values. |
| `target` | list of number |  | Point [x, y, z] the camera looks at Exactly 3 values. |

```json
POST /api/commands/set_camera
{}
```

### load_scene

**Load scene recipe** · changes the scene (one undo step)

Replace the current scene with a full scene JSON (the format returned by get_scene). Useful for recipes.

| Input | Type | Required | Description |
|---|---|---|---|
| `scene` | object | yes | A complete scene in the format get_scene returns |

```json
POST /api/commands/load_scene
{"scene":{}}
```

### undo

**Undo**

Undo the last change.

_No inputs._

```json
POST /api/commands/undo
{}
```

### redo

**Redo**

Redo the last undone change.

_No inputs._

```json
POST /api/commands/redo
{}
```

### run_batch

**Run batch**

Run many commands in one go, as a single undo step. If one fails, everything is rolled back. Use "$N.id" inside string arguments to refer to the id returned by command number N (0-based), e.g. parent: "$0.id".

| Input | Type | Required | Description |
|---|---|---|---|
| `commands` | list of object | yes | Steps to run in order: [{ "command": "add_object", "args": { … } }, …] |

```json
POST /api/commands/run_batch
{"commands":[{"command":"example"}]}
```

## Objects

### add_object

**Add object** · changes the scene (one undo step)

Add a shape to the scene. Units are metres, Y is up, rotation is in degrees. If no position is given the object rests on the ground at the origin. Params per type (with defaults): box {"width":1,"height":1,"depth":1,"bevel":0.04,"bevelSegments":4}; sphere {"radius":0.5,"segments":48}; cylinder {"radiusTop":0.5,"radiusBottom":0.5,"height":1,"segments":48,"thetaLength":360}; cone {"radius":0.5,"height":1,"segments":48}; torus {"radius":0.4,"tube":0.15,"segments":48}; plane {"width":1,"height":1}; capsule {"radius":0.3,"length":0.6,"segments":24}; lathe {"points":[[0,0],[0.3,0],[0.38,0.25],[0.3,0.6],[0.15,0.75],[0.15,0.9],[0,0.9]],"segments":48}; extrude {"points":[[-0.4,0],[0.4,0],[0.4,0.5],[0,0.9],[-0.4,0.5]],"holes":[],"depth":0.2,"bevel":0.02,"bevelSegments":3}; text {"text":"Hello","size":0.3,"depth":0.08,"bevel":0.008,"font":"helvetiker_bold"}; rock {"radius":0.5,"detail":3,"roughness":0.35,"flatten":0.35,"sharpness":0.5,"seed":1}; image {"assetId":null,"width":1,"height":1}; cutout {"assetId":null,"width":1,"height":1,"depth":0.05,"bevel":0.006,"threshold":0.5}; model {"assetId":null,"size":1}; voxels {"voxelSize":0.1,"voxels":[[0,0,0,0]],"palette":["#c8a064"]}. Notes: cylinder: thetaLength (degrees) < 360 makes a partial cylinder centred on its local +X side; e.g. thetaLength 180 with rotation [0, 0, 90] is a rounded chest lid pointing up. lathe: points = profile [[radius, y], ...] from bottom to top, spun around the Y axis. Start/end at radius 0 to close it (bottles, vases, barrels, chess pieces). extrude: points = flat outline [[x, y], ...] pushed out by depth along Z; holes = list of outlines (blades, signs, gears, logos). text: fonts: helvetiker_regular, helvetiker_bold, optimer_regular, optimer_bold, gentilis_regular, gentilis_bold. rock: lumpy natural stone. roughness = bumpiness, flatten = flat bottom, sharpness 0 = smooth, 1 = faceted. Different seed = different rock. cutout: turns an image into a solid shape that follows its outline (transparent PNGs work best). threshold 0-1 decides what counts as background. voxels: blocks on a grid (3D pixels): voxels = [[x, y, z, paletteIndex]], palette = colours, voxelSize = block size in m. y = 0 is the bottom layer. Edit with edit_voxels. model: a ready-made 3D model from the library (import_model or generate_3d). size = height in metres, 0 = original size. Keeps its own materials. Tip: boxes have a "bevel" param (rounded edges) which makes them look far more real; keep it above 0.

| Input | Type | Required | Description |
|---|---|---|---|
| `type` | one of | yes | Shape type; each has its own params (listed in the description above) Allowed: "box", "sphere", "cylinder", "cone", "torus", "plane", "capsule", "lathe", "extrude", "text", "rock", "image", "cutout", "model", "voxels", "group". |
| `name` | string |  | A readable name (letters, numbers, - and _) |
| `parent` | string |  | Id of a group to put this object in |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Rotation [x, y, z] in degrees Exactly 3 values. |
| `scale` | list of number or number |  | Scale [x, y, z] or one number for all axes |
| `params` | object |  | Shape size settings, see description |
| `material` | object |  | Surface settings, the same fields as set_material |
| `visible` | boolean |  | Start hidden (false) or visible (true, default) |

```json
POST /api/commands/add_object
{"type":"box"}
```

### update_object

**Update object** · changes the scene (one undo step)

Change an object's name, transform, shape params, visibility or parent. Only the fields you pass change; params are merged.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `name` | string |  | A readable name (letters, numbers, - and _) |
| `parent` | string or null |  | Group id, or null to move to the top level |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Rotation [x, y, z] in degrees Exactly 3 values. |
| `scale` | list of number or number |  | Scale [x, y, z] or one number for all axes |
| `params` | object |  | Shape settings to change; only the given ones change |
| `visible` | boolean |  | false hides the object (it stays in the scene) |

```json
POST /api/commands/update_object
{"id":"_1"}
```

### set_material

**Set material** · changes the scene (one undo step)

Change the surface look of one or more objects. Applying to a group changes everything inside it. Use a preset as a starting point, then tweak colour/roughness/metalness.

| Input | Type | Required | Description |
|---|---|---|---|
| `preset` | one of |  | Start from a preset (resets other material values first): plastic, matte, ceramic, rubber, wood, stone, steel, brushed_metal, chrome, gold, copper, glass, glow, oak, dark_wood, floor_planks, old_wood, brushed_steel, worn_metal, rusty_metal, cobblestone, brick_wall, floor_tiles, cloth, concrete, hand_painted Allowed: "plastic", "matte", "ceramic", "rubber", "wood", "stone", "steel", "brushed_metal", "chrome", "gold", "copper", "glass", "glow", "oak", "dark_wood", "floor_planks", "old_wood", "brushed_steel", "worn_metal", "rusty_metal", "cobblestone", "brick_wall", "floor_tiles", "cloth", "concrete", "hand_painted". |
| `color` | string |  | CSS colour, e.g. "#ff8800" or "orange" |
| `metalness` | number |  | 0 = non-metal, 1 = metal Range 0 to 1. |
| `roughness` | number |  | 0 = mirror-smooth, 1 = fully matte Range 0 to 1. |
| `emissive` | string |  | Glow colour |
| `emissiveIntensity` | number |  | How strongly it glows (0 = not, 1–3 = glowing, higher = blazing) Range 0 to 50. |
| `opacity` | number |  | Opacity from 0 (invisible) to 1 (solid) Range 0 to 1. |
| `transmission` | number |  | Glass-like transparency Range 0 to 1. |
| `ior` | number |  | Index of refraction for glass (1.5 = window glass) Range 1 to 2.5. |
| `thickness` | number |  | Thickness of see-through material in metres (changes how glass bends light) Range 0 to …. |
| `clearcoat` | number |  | Glossy lacquer layer on top Range 0 to 1. |
| `texture` | string or null |  | Image asset id from import_image, or null to remove |
| `textureRepeat` | list of number |  | How often the texture repeats [u, v] Exactly 2 values. |
| `flatShading` | boolean |  | Faceted low-poly look |
| `doubleSided` | boolean |  | Show both sides of thin surfaces |
| `pattern` | object or null |  | Generated surface (wood, rust, brick...). For tinted patterns the material colour is the lightest tone. null removes it. Partial objects update the current pattern. |
| `wear` | number |  | Age: 0 = brand new, 1 = very old (grime, scratches, faded colour, darker worn edges on bevelled boxes) Range 0 to 1. |
| `id` | string |  | Id of the object to work on (see get_scene; ids look like "box_1") |
| `ids` | list of string |  | Several object ids |

```json
POST /api/commands/set_material
{}
```

### delete_object

**Delete object** · changes the scene (one undo step)

Remove an object (and everything inside it if it is a group).

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |

```json
POST /api/commands/delete_object
{"id":"_1"}
```

### duplicate_object

**Duplicate object** · changes the scene (one undo step)

Copy an object (with its children). The copy is moved by offset (default 1.2 m along X).

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `offset` | list of number |  | How far the copy is moved [x, y, z] (default [1.2, 0, 0]) Exactly 3 values. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/duplicate_object
{"id":"_1"}
```

### get_object

**Get object**

Return all details of one object.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |

```json
POST /api/commands/get_object
{"id":"_1"}
```

## Modelling

### cut_object

**Cut / combine objects** · changes the scene (one undo step)

Combine two shapes. op "subtract" cuts the cutter's shape out of the target (holes, windows, keyholes, grooves), "union" melts them into one surface, "intersect" keeps only the overlap. The cutter stays in the scene but is hidden; move or resize it later and the result updates. A target can have several cutters. Cutters cannot be groups.

| Input | Type | Required | Description |
|---|---|---|---|
| `target` | string | yes | Id of the shape that gets cut |
| `cutter` | string | yes | Id of the shape that does the cutting (it gets hidden) |
| `op` | one of |  | subtract (cut away, default), union (melt together) or intersect (keep only the overlap) Allowed: "subtract", "union", "intersect". |
| `hideCutter` | boolean |  | Default true |

```json
POST /api/commands/cut_object
{"target":"example","cutter":"example"}
```

### uncut_object

**Remove a cut** · changes the scene (one undo step)

Undo a cut/combine between target and cutter and show the cutter again.

| Input | Type | Required | Description |
|---|---|---|---|
| `target` | string | yes | Id of the shape that was cut |
| `cutter` | string | yes | Id of the cutting shape to stop using |

```json
POST /api/commands/uncut_object
{"target":"example","cutter":"example"}
```

### group_objects

**Group objects** · changes the scene (one undo step)

Put several objects into a new group so they move, animate, export and get saved together. The group sits at their middle; the objects keep their place. They must share the same parent (all top-level, or all inside the same group).

| Input | Type | Required | Description |
|---|---|---|---|
| `ids` | list of string | yes | Several object ids |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/group_objects
{"ids":["example"]}
```

### ungroup

**Ungroup** · changes the scene (one undo step)

Dissolve a group: its objects move up one level and keep their place in the world; the empty group is removed.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |

```json
POST /api/commands/ungroup
{"id":"_1"}
```

### repeat_object

**Repeat object** · changes the scene (one undo step)

Make copies of an object in a pattern. mode "line": each copy moves by offset (fence posts, stairs). mode "circle": copies spread evenly around a centre on the Y axis, turned to match (wheel spokes, columns around a tower, petals). mode "grid": rows and columns on the ground (tiles, crops). Set group true to collect everything into one new group.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `count` | integer | yes | Number of extra copies Range 1 to 200. |
| `mode` | one of |  | line (in a row, default), circle (around a centre) or grid (rows and columns) Allowed: "line", "circle", "grid". |
| `offset` | list of number |  | line: step between copies (default [1.2, 0, 0]) Exactly 3 values. |
| `center` | list of number |  | circle: centre point (default [0, y, 0] in the parent) Exactly 3 values. |
| `rotate` | boolean |  | circle: turn copies to face outward like the original (default true) |
| `columns` | integer |  | grid: objects per row (default: square-ish) Range 1 to 9007199254740991. |
| `spacing` | list of number |  | grid: [x, z] distance (default [1.2, 1.2]) Exactly 2 values. |
| `group` | boolean |  | Put the original and all copies into one new group |
| `name` | string |  | Name for the new group |

```json
POST /api/commands/repeat_object
{"id":"_1","count":1}
```

### mirror_object

**Mirror object** · changes the scene (one undo step)

Make a mirrored copy of an object (with its children) on the other side of a plane. Build one half (a left wing, a left arm, half a face) and mirror it to get a symmetric whole.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `axis` | one of |  | Mirror across this axis (default x = left/right) Allowed: "x", "y", "z". |
| `center` | number |  | Position of the mirror plane on that axis (default 0) |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/mirror_object
{"id":"_1"}
```

## Animation

### animate_object

**Animate object** · changes the scene (one undo step)

Add a ready-made movement to an object or group. Presets: spin (Turn around an axis (coins, pickups, turntables). turns = full turns per loop; params {"axis":"y","turns":1}); bob (Float up and down (pickups, floating crystals). height in metres; params {"height":0.08}); pulse (Grow and shrink a little (heartbeat, magic). amount 0.1 = 10%; params {"amount":0.1}); swing (Rock back and forth around an axis (signs, lanterns, pendulums). angle in degrees; params {"axis":"z","angle":15}); hinge (Open and close around the object's own origin, like a door or a chest lid (use the lid/door group). angle in degrees; pingpong false = open once; params {"axis":"x","angle":-100,"pingpong":true}); shake (Jitter in place (hit reaction, rumbling). amount in metres; params {"amount":0.02}); hop (Jump up and land with a little squash (cute pickups, characters). height in metres; params {"height":0.25}). Several presets on the same object add up (e.g. spin + bob for a pickup). Animations loop over "duration" seconds; they show in the window, in sprite sheets and in exported GLB files (Godot gets an AnimationPlayer).

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `preset` | one of | yes | Movement preset (descriptions above) Allowed: "spin", "bob", "pulse", "swing", "hinge", "shake", "hop". |
| `params` | object |  | Preset settings (see the preset list above for each preset's settings) |
| `animation` | string |  | Animation name, default "idle". One scene can hold several (idle, open, hit...) |
| `duration` | number |  | Seconds for one loop of the whole animation Range 0.1 to 120. |
| `speed` | integer |  | Repeat this movement N times per loop (whole numbers keep loops seamless) Range 1 to 16. |
| `offset` | number |  | Start later in the cycle (0..1), to make copies move out of step Range 0 to 1. |

```json
POST /api/commands/animate_object
{"id":"_1","preset":"spin"}
```

### set_keyframes

**Set keyframes** · changes the scene (one undo step)

Custom movement for an object: keys = [{ t: 0..1, position?: [x,y,z], rotation?: [deg,deg,deg], scale?: [x,y,z] }]. Values are offsets from the object's normal pose (scale multiplies). Replaces earlier custom keys for that object in this animation. For a seamless loop, make the last key equal to the first.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `animation` | string |  | Animation name, default "idle". One scene can hold several (idle, open, hit...) |
| `duration` | number |  | Length in seconds Range 0.1 to 120. |
| `keys` | list of object | yes | Moments [{ "t": 0..1, "position"?: […], "rotation"?: […], "scale"?: […] }] as offsets from the normal pose |

```json
POST /api/commands/set_keyframes
{"id":"_1","keys":[{"t":0},{"t":0}]}
```

### set_animation

**Animation settings** · changes the scene (one undo step)

Change an animation's length (seconds), looping, or name.

| Input | Type | Required | Description |
|---|---|---|---|
| `animation` | string | yes | Name of the animation to change |
| `duration` | number |  | Length in seconds Range 0.1 to 120. |
| `loop` | boolean |  | Repeat endlessly (true) or play once (false) |
| `rename` | string |  | New name for the animation |

```json
POST /api/commands/set_animation
{"animation":"example"}
```

### remove_animation

**Remove animation** · changes the scene (one undo step)

Remove the movement of one object from an animation (give id), or the whole animation (no id).

| Input | Type | Required | Description |
|---|---|---|---|
| `animation` | string | yes | Name of the animation |
| `id` | string |  | Id of the object to work on (see get_scene; ids look like "box_1") |

```json
POST /api/commands/remove_animation
{"animation":"example"}
```

### list_animations

**List animations**

List the scene's animations with their tracks.

_No inputs._

```json
POST /api/commands/list_animations
{}
```

## Pictures & exports

### render_preview

**Render preview**

Render a picture of the scene and return it, so you can SEE the result. Use this after every few changes to check quality: proportions, lighting, materials, gaps between parts.

| Input | Type | Required | Description |
|---|---|---|---|
| `view` | one of |  | Camera angle. iso = 3/4 view from the front-right (default). camera = the scene camera. Allowed: "iso", "iso_back", "front", "back", "left", "right", "top", "camera". |
| `width` | integer |  | Picture width in pixels (default 768) Range 64 to 4096. |
| `height` | integer |  | Picture height in pixels (default 768) Range 64 to 4096. |
| `target` | string |  | Object id to frame; default frames everything visible |
| `background` | string |  | Override background, or "transparent" |
| `ground` | boolean |  | Override whether the ground/shadow is shown |
| `sizeReference` | boolean |  | Show a see-through 1.8 m person next to it, to judge the size |
| `save` | string |  | Also save as exports/<save>.png |

```json
POST /api/commands/render_preview
{}
```

### export_png

**Export PNG**

Render a high-quality PNG file into the exports folder. Transparent background by default.

| Input | Type | Required | Description |
|---|---|---|---|
| `view` | one of |  | Camera angle. iso = 3/4 view from the front-right (default). camera = the scene camera. Allowed: "iso", "iso_back", "front", "back", "left", "right", "top", "camera". |
| `width` | integer |  | Picture width in pixels (default 1024) Range 64 to 4096. |
| `height` | integer |  | Picture height in pixels (default 1024) Range 64 to 4096. |
| `target` | string |  | Object id to frame; default frames everything visible |
| `background` | string |  | Override background, or "transparent" |
| `ground` | boolean |  | Override whether the ground/shadow is shown |
| `sizeReference` | boolean |  | Show a see-through 1.8 m person next to it, to judge the size |
| `filename` | string | yes | Name for the saved file, without extension |

```json
POST /api/commands/export_png
{"filename":"my_asset"}
```

### export_glb

**Export GLB**

Export the scene (or one object/group) as a .glb 3D model file with textures and animations embedded. Opens in Godot, Unity, Unreal and Blender. A single object is exported at the origin. For Godot projects, export_godot also adds collision.

| Input | Type | Required | Description |
|---|---|---|---|
| `filename` | string | yes | Name for the saved file, without extension |
| `target` | string |  | Object or group id; default exports everything visible |
| `collision` | one of |  | Add a Godot collision shape (default none) Allowed: "box", "convex", "mesh", "none". |

```json
POST /api/commands/export_glb
{"filename":"my_asset"}
```

## Game assets

### make_icons

**Make icons**

Render inventory/UI icons: one square PNG per object, all with the same angle, light and framing, transparent background and an optional outline. Default: every top-level object in the scene. Files go to exports/<folder>/.

| Input | Type | Required | Description |
|---|---|---|---|
| `ids` | list of string |  | Several object ids |
| `size` | integer |  | Pixels, default 256 Range 16 to 2048. |
| `view` | one of |  | Camera angle for all icons (default iso) Allowed: "iso", "iso_back", "front", "back", "left", "right", "top", "camera". |
| `background` | string |  | Default "transparent" |
| `outline` | string or null |  | Outline colour around the icon, null for none (default dark grey) |
| `outlineWidth` | integer |  | Outline thickness in pixels Range 1 to 16. |
| `padding` | number |  | Empty border, fraction of the size (default 0.06) Range 0 to 0.5. |
| `folder` | string |  | Default "icons" |

```json
POST /api/commands/make_icons
{}
```

### render_sprites

**Render sprite sheet**

Turn a 3D object into a 2D sprite sheet for 2D games. Rows = directions (1, 4 or 8; row 0 = facing the viewer/down, then down-left, left, up-left, up, up-right, right, down-right for 8), repeated per animation when several are given; columns = frames. pixelArt gives crisp pixels with a limited palette (a named palette like "pico8" or "endesga32", or a colour list), optional dithering, clean-up and an outline (solid, or "selout" = darker shade of the touching colour). maps ["normal", "emission"] also writes a normal map (for Godot 2D lights) and a glow map. pixelsPerMetre keeps several assets at the same scale. With project (a Godot project folder) the files go there plus a SpriteFrames .tres for AnimatedSprite2D. Returns the sheet so you can look at it.

| Input | Type | Required | Description |
|---|---|---|---|
| `target` | string |  | Object or group id; default the whole scene |
| `filename` | string | yes | Name for the saved file, without extension |
| `directions` | number |  | Default 8 |
| `frameSize` | integer |  | Pixels per frame, default 64 Range 8 to 1024. |
| `animation` | string |  | One animation to sample (see list_animations) |
| `animations` | list of string |  | Several animations in one sheet, e.g. ["idle", "walk", "attack"] |
| `frames` | integer |  | Frames per direction when animated, default 8 Range 1 to 64. |
| `elevation` | number |  | Camera angle above the ground: 0 = side view, 30 = classic 2:1 isometric (default), 60+ = top-down Range 0 to 90. |
| `azimuthOffset` | number |  | Turn the camera around the object first, in degrees (45 gives diamond-shaped isometric tiles) |
| `pixelsPerMetre` | number |  | Fixed scale (e.g. 32); default fits the object in the frame Range 1 to 2048. |
| `pixelArt` | boolean |  | Default true |
| `colors` | integer |  | Palette size when no palette is given, default 24 Range 2 to 256. |
| `palette` | string or list of string |  | Palette name (see list_palettes, e.g. "pico8") or a list of colours like ["#1a1c2c", "#5d275d"] |
| `dither` | number |  | Checkered shading between colours, 0 = none (default), 0.5 = subtle, 1 = strong Range 0 to 1. |
| `outline` | string or null |  | Outline colour for the solid style, null for no outline (default dark) |
| `outlineStyle` | one of |  | "solid" = one outline colour, "selout" = a darker shade of the touching colour, "none" = no outline Allowed: "solid", "selout". |
| `cleanup` | boolean |  | Remove lonely stray pixels (default true) |
| `maps` | list of one of |  | Extra pictures: "normal" (for Godot 2D lights) and/or "emission" (glowing parts) |
| `groundShadow` | boolean |  | Keep the soft shadow under the object (default false) |
| `project` | string |  | Godot project folder: write the sprites there with a SpriteFrames .tres |
| `folder` | string |  | Folder inside the Godot project, default "assets/forge/sprites" |

```json
POST /api/commands/render_sprites
{"filename":"my_asset"}
```

### export_godot

**Export to Godot**

Export an object (or the scene) as a .glb straight into a Godot 4 project, with a collision shape and animations. Godot imports it automatically when its editor gets focus; drag it into a scene to use it. The object is exported at the origin, so it is easy to place.

| Input | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | Folder of the Godot project (the one containing project.godot) |
| `folder` | string |  | Folder inside the project, default "assets/forge" |
| `filename` | string |  | Default: the object's name |
| `target` | string |  | Object or group to export (default: the whole scene) |
| `collision` | one of |  | Collision shape for Godot: box (fast, default), convex (wraps the shape), mesh (exact, for static level parts), none Allowed: "box", "convex", "mesh", "none". |

```json
POST /api/commands/export_godot
{"project":"example"}
```

### export_each

**Export each object**

Export every top-level object (or every child of one group, e.g. a level kit) as its own .glb, each at the origin with a collision shape. Without project the files go to exports/<folder>/; with project they go straight into that Godot project.

| Input | Type | Required | Description |
|---|---|---|---|
| `group` | string |  | Export the children of this group instead of the top-level objects |
| `folder` | string |  | Default "kit" (or "assets/forge" inside a Godot project) |
| `project` | string |  | Godot project folder (optional) |
| `collision` | one of |  | Collision shape for Godot: box (fast, default), convex (wraps the shape), mesh (exact, for static level parts), none Allowed: "box", "convex", "mesh", "none". |

```json
POST /api/commands/export_each
{}
```

### make_tileset

**Make pixel tileset**

Generate a seamless pixel-art tileset where one ground type (overlay, e.g. grass) blends into another (base, e.g. dirt): 16 tiles covering every corner combination, so any map paints without seams. Saves a 4x4 tile atlas. With project (a Godot 4 project folder) it also writes a TileSet .tres with terrains set up ("match corners"), so you can paint with the terrain tool. Adds the atlas to the image library and returns it so you can look at it.

| Input | Type | Required | Description |
|---|---|---|---|
| `base` | object |  | Default dirt |
| `overlay` | object |  | Default grass |
| `tileSize` | integer |  | Pixels per tile, default 16 Range 8 to 128. |
| `palette` | string or list of string |  | Palette name (see list_palettes) or colours |
| `colors` | integer |  | Number of colours when no palette is given (default 16) Range 2 to 64. |
| `edge` | boolean |  | Dark rim where the two grounds meet (default true) |
| `roughness` | number |  | How wobbly the border between the grounds is (default 0.35) Range 0 to 1. |
| `seed` | integer |  | Variation of the ground patterns Range -9007199254740991 to 9007199254740991. |
| `filename` | string | yes | Name for the saved file, without extension |
| `project` | string |  | Folder of a Godot 4 project (the folder that contains project.godot); files are written straight into it |
| `folder` | string |  | Folder inside the Godot project, default "assets/forge/tiles" |

```json
POST /api/commands/make_tileset
{"filename":"my_asset"}
```

## Generators

### make_crate

**Crate**

Build a wooden crate as one group (frame posts, beams, diagonal braces, panels, optional metal corners). Returns the group id. Vary seed for different wood tones.

| Input | Type | Required | Description |
|---|---|---|---|
| `size` | number |  | Edge length in metres (default 1) Range 0.2 to 10. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `woodColor` | string |  | Lightest wood tone as hex, e.g. "#c8955c" (default warm oak) |
| `metalCorners` | boolean |  | Add metal caps on the corners |
| `braces` | boolean |  | Diagonal braces on front and back (default true) |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `wear` | number |  | Age: 0 = new, 1 = very old and dirty Range 0 to 1. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_crate
{}
```

### make_barrel

**Barrel**

Wooden barrel with bulging staves, a lid and metal hoops. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `height` | number |  | Default 1 m Range 0.2 to 5. |
| `radius` | number |  | Widest radius, default 0.36 m Range 0.05 to 3. |
| `woodColor` | string |  | Lightest wood tone |
| `metalColor` | string |  | Colour of the hoops |
| `wear` | number |  | Age from 0 (brand new) to 1 (very old: grime, scratches, faded) Range 0 to 1. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_barrel
{}
```

### make_chest

**Chest**

Treasure chest with a rounded lid, metal bands, corner caps and a lock with a keyhole. Can be open with gold inside. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `width` | number |  | Default 0.9 m Range 0.2 to 5. |
| `depth` | number |  | Default 0.55 m Range 0.15 to 5. |
| `height` | number |  | Body height without lid, default 0.42 m Range 0.1 to 5. |
| `open` | boolean |  | Open lid (default false) |
| `treasure` | boolean |  | Gold coins inside (visible when open; default true) |
| `woodColor` | string |  | Lightest wood tone |
| `metalColor` | string |  | Colour of the bands and corners |
| `wear` | number |  | Age from 0 (brand new) to 1 (very old: grime, scratches, faded) Range 0 to 1. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_chest
{}
```

### make_rock

**Rock**

Natural stone: a single boulder, a cluster, or scattered pebbles. Optional moss on top. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `size` | number |  | Approximate size of the biggest stone, default 0.7 m Range 0.05 to 20. |
| `style` | one of |  | boulder (one stone), cluster (a few) or pebbles (many small ones) Allowed: "boulder", "cluster", "pebbles". |
| `color` | string |  | Lightest stone tone |
| `moss` | boolean |  | Grow moss on top |
| `lowpoly` | boolean |  | Faceted stones |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_rock
{}
```

### make_tree

**Tree**

Stylised tree: "round" (leafy blobs), "pine" (stacked cones) or "dead" (bare branches). Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `height` | number |  | Default 2.6 m Range 0.3 to 30. |
| `style` | one of |  | round (leafy), pine (cones) or dead (bare branches) Allowed: "round", "pine", "dead". |
| `leafColor` | string |  | Colour of the leaves |
| `trunkColor` | string |  | Colour of the bark |
| `lowpoly` | boolean |  | Faceted low-poly look |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_tree
{}
```

### make_crystal

**Crystal**

Cluster of glowing hexagonal crystals growing from a small rock. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `height` | number |  | Tallest crystal, default 0.8 m Range 0.05 to 10. |
| `count` | integer |  | Default 6 Range 1 to 15. |
| `color` | string |  | Crystal colour, default icy blue |
| `glow` | number |  | Glow strength, default 1 (0 = no glow; above 3 turns white-hot) Range 0 to 20. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_crystal
{}
```

### make_potion

**Potion**

Glass potion bottle with glowing liquid and a cork. Shapes: round, tall, flask. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `height` | number |  | Default 0.3 m Range 0.05 to 3. |
| `shape` | one of |  | round, tall or flask Allowed: "round", "tall", "flask". |
| `liquidColor` | string |  | Colour of the potion |
| `fill` | number |  | How full, default 0.7 Range 0.1 to 1. |
| `glow` | number |  | Liquid glow, default 2 (0 = none) Range 0 to 20. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_potion
{}
```

### make_sword

**Sword**

Standing sword: bevelled blade with a groove (fuller), crossguard, wrapped grip and pommel. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `length` | number |  | Total length, default 1 m Range 0.2 to 5. |
| `bladeWidth` | number |  | Default 0.09 m Range 0.01 to 1. |
| `guardColor` | string |  | Colour of the crossguard and pommel |
| `gripColor` | string |  | Colour of the grip wrapping |
| `wear` | number |  | Age from 0 (brand new) to 1 (very old: grime, scratches, faded) Range 0 to 1. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_sword
{}
```

### make_coin

**Coin**

Coin with a raised rim and an embossed symbol (letters/numbers). count > 1 makes a stack. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `radius` | number |  | Default 0.06 m Range 0.005 to 2. |
| `symbol` | string |  | Up to 3 letters or digits, default "$" |
| `material` | one of |  | Metal of the coin Allowed: "gold", "copper", "steel", "chrome". |
| `count` | integer |  | Number of coins in the stack Range 1 to 40. |
| `upright` | boolean |  | Stand the coin on its edge, facing forward (for spinning pickups) |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_coin
{}
```

### make_lamp_post

**Lamp post**

Classic street lamp: moulded base, pole, glass lantern with a glowing bulb and a pointed cap. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `height` | number |  | Default 2.6 m Range 0.5 to 15. |
| `lightColor` | string |  | Colour of the light |
| `metalColor` | string |  | Colour of the post |
| `glow` | number |  | Default 6 Range 0 to 30. |
| `wear` | number |  | Age from 0 (brand new) to 1 (very old: grime, scratches, faded) Range 0 to 1. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_lamp_post
{}
```

### make_fence

**Fence**

Wooden fence segment along X: posts, rails and pointed pickets ("picket") or just rails ("rail"). Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `length` | number |  | Default 3 m Range 0.3 to 50. |
| `height` | number |  | Default 0.9 m Range 0.2 to 5. |
| `style` | one of |  | picket (pointed boards) or rail (horizontal rails only) Allowed: "picket", "rail". |
| `paint` | string |  | Paint colour; leave out for bare wood |
| `wear` | number |  | Age from 0 (brand new) to 1 (very old: grime, scratches, faded) Range 0 to 1. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_fence
{}
```

### make_level_kit

**Level kit**

A set of matching building pieces that snap together on a grid: floor, wall, wall with door, wall with window, pillar and stairs. Each piece is its own group (child of the kit) laid out in a row; every piece is gridSize wide. Floors are centred on their origin with the top at y = 0; walls stand on their origin line (turn them 90° for corners). Export them as separate files with export_each { group: <kit id> } (e.g. for a Godot GridMap). Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `style` | one of |  | dungeon (default), cottage, scifi Allowed: "dungeon", "cottage", "scifi". |
| `gridSize` | number |  | Default 2 m Range 0.5 to 10. |
| `wallHeight` | number |  | Default 2.6 m Range 0.5 to 10. |
| `wallThickness` | number |  | Default 0.25 m Range 0.05 to 2. |
| `wear` | number |  | Age from 0 (brand new) to 1 (very old: grime, scratches, faded) Range 0 to 1. |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_level_kit
{}
```

### make_character

**Character**

A jointed game character (chibi or normal proportions) with hair or a hat, clothes colours and an optional weapon/shield, plus ready-made animations: idle, walk, run, attack, jump. Made for 8-direction sprite sheets: render_sprites { target, animations: ["idle","walk","attack"], directions: 8 } — and it also exports as an animated 3D model. Builds one group and returns its id. Common options: position, seed (different variation), name.

| Input | Type | Required | Description |
|---|---|---|---|
| `style` | one of |  | chibi = big head, reads well at small sprite sizes (default) Allowed: "chibi", "normal". |
| `height` | number |  | Default 1 m Range 0.2 to 10. |
| `skin` | string |  | Skin colour |
| `hair` | string |  | Hair colour |
| `shirt` | string |  | Shirt colour |
| `pants` | string |  | Trousers colour |
| `shoes` | string |  | Shoe colour |
| `hat` | one of |  | none, wizard, helmet or hood Allowed: "none", "wizard", "helmet", "hood". |
| `weapon` | one of |  | none, sword or staff Allowed: "none", "sword", "staff". |
| `shield` | boolean |  | Carry a shield on the left arm |
| `animations` | boolean |  | Add the ready-made animations (default true) |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `rotation` | list of number |  | Degrees Exactly 3 values. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_character
{}
```

## Pixel art

### make_effect

**Make pixel effect**

Make an animated pixel-art effect as a sprite strip: explosion, fire, smoke, magic, sparks, glitter, heal, lightning. fire, smoke, magic, glitter and heal loop seamlessly; explosion, sparks and lightning play once. color tints it (e.g. green fire); palette snaps it to a palette. With project (a Godot project folder) it also writes a SpriteFrames .tres.

| Input | Type | Required | Description |
|---|---|---|---|
| `type` | one of | yes | Which effect (see the list above) Allowed: "explosion", "fire", "smoke", "magic", "sparks", "glitter", "heal", "lightning". |
| `size` | integer |  | Frame size in pixels, default 64 Range 16 to 256. |
| `frames` | integer |  | Number of frames (default per effect, usually 6–10) Range 2 to 32. |
| `color` | string |  | CSS colour, e.g. "#ff8800" or "orange" |
| `palette` | string or list of string |  | Palette name (see list_palettes) or colours; default the house style palette |
| `colors` | integer |  | Colour count when no palette (default 12) Range 2 to 64. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `filename` | string |  | Name for the saved file, without extension |
| `project` | string |  | Folder of a Godot 4 project (the folder that contains project.godot); files are written straight into it |
| `folder` | string |  | Folder name inside the Godot project (with project) or inside workspace/exports |

```json
POST /api/commands/make_effect
{"type":"explosion"}
```

### make_parallax

**Make parallax background**

Make a layered pixel-art background for side-scrolling games: sky, far, middle and near layers that each repeat seamlessly sideways. Themes: mountains, forest, city, clouds. Time: day, sunset, night. Saves every layer as a PNG plus a preview and suggested scroll speeds.

| Input | Type | Required | Description |
|---|---|---|---|
| `theme` | one of |  | mountains, forest, city or clouds Allowed: "mountains", "forest", "city", "clouds". |
| `time` | one of |  | day, sunset or night Allowed: "day", "sunset", "night". |
| `width` | integer |  | Default 320 Range 64 to 2048. |
| `height` | integer |  | Default 180 Range 64 to 1024. |
| `palette` | string or list of string |  | Palette name (see list_palettes) or colours; default the house style palette |
| `colors` | integer |  | How many colours to use when no palette is given Range 2 to 64. |
| `seed` | integer |  | Whole number that picks a variation; the same seed always gives the same result Range -9007199254740991 to 9007199254740991. |
| `filename` | string |  | Name for the saved file, without extension |
| `project` | string |  | Folder of a Godot 4 project (the folder that contains project.godot); files are written straight into it |
| `folder` | string |  | Folder name inside the Godot project (with project) or inside workspace/exports |

```json
POST /api/commands/make_parallax
{}
```

### recolor_image

**Swap colours**

Swap exact colours in a picture, e.g. map { "#3f7fd1": "#d13f3f" } turns a blue shirt red. Creates a new library image. Use extract_palette to see which colours a picture uses.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `map` | object | yes | Colour swaps: { "#from": "#to", … } |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/recolor_image
{"assetId":"asset_1","map":{}}
```

### make_palette_variants

**Colour variants**

Make colour versions of a sprite by turning every colour around the colour wheel (a red, green and blue slime from one design). Creates new library images.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `count` | integer |  | Default 3 Range 1 to 12. |
| `saturation` | number |  | 1 = unchanged Range 0 to 2. |

```json
POST /api/commands/make_palette_variants
{"assetId":"asset_1"}
```

### extract_palette

**Steal a palette**

Pick the main colours out of any picture (sorted dark to light). Optionally save them as a house style so all your art can use them.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `count` | integer |  | How many colours to pick (default 16) Range 2 to 64. |
| `saveAsHouseStyle` | string |  | Also save the colours as a house style with this name |

```json
POST /api/commands/extract_palette
{"assetId":"asset_1"}
```

### check_pixel_style

**Pixel style check**

Check a pixel-art picture for common problems: blurry half-transparent pixels, too many colours, colours outside the palette, lonely stray pixels, and a size that does not fit the tile grid.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `palette` | string or list of string |  | Palette name (see list_palettes) or colours; default the house style palette |
| `maxColors` | integer |  | Default 32 Range -9007199254740991 to 9007199254740991. |
| `grid` | integer |  | Tile/frame size the picture should be a multiple of Range -9007199254740991 to 9007199254740991. |

```json
POST /api/commands/check_pixel_style
{"assetId":"asset_1"}
```

### paint_pixels

**Paint pixels**

Edit a picture pixel by pixel: pixels = [[x, y, "#hex" or null to erase]], fills = [[x, y, "#hex" or null]] flood-fills the area of the same colour. Coordinates start at the top-left (0, 0). Creates a new library image (the original stays) unless replace is true.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `pixels` | list of list of values |  | Pixels to set: [[x, y, "#hex"], …]; null instead of a colour erases |
| `fills` | list of list of values |  | Flood fills: [[x, y, "#hex"], …]; fills the connected area of the same colour |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/paint_pixels
{"assetId":"asset_1"}
```

### export_aseprite

**Export to Aseprite**

Turn a sprite sheet from the library into an .aseprite file (one frame per cell, a tag per row so every animation/direction is named) to keep working in Aseprite. Give the frame size; rowNames name the tags (render_sprites returns them).

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `frameWidth` | integer | yes | Width of one frame in pixels Range 1 to 9007199254740991. |
| `frameHeight` | integer |  | Height of one frame in pixels (default: same as the width) Range 1 to 9007199254740991. |
| `fps` | number |  | Default 10 Range 1 to 60. |
| `rowNames` | list of string |  | Names for the animation tags, one per row (render_sprites returns them) |
| `filename` | string |  | Name for the saved file, without extension |

```json
POST /api/commands/export_aseprite
{"assetId":"asset_1","frameWidth":1}
```

### make_prop_sheet

**Prop sheet**

Render several objects as pixel-art props with the same camera, scale and palette, packed into one sheet (with a .json listing where each one is). Default: all top-level objects.

| Input | Type | Required | Description |
|---|---|---|---|
| `ids` | list of string |  | Several object ids |
| `frameSize` | integer |  | Default 48 Range 8 to 512. |
| `pixelsPerMetre` | number |  | Same scale for all, e.g. 32 (default fits each) Range 1 to …. |
| `elevation` | number |  | Camera height in degrees (default 30) Range 0 to 90. |
| `palette` | string or list of string |  | Palette name (see list_palettes) or colours; default the house style palette |
| `outlineStyle` | one of |  | "solid" = one outline colour, "selout" = a darker shade of the touching colour, "none" = no outline Allowed: "solid", "selout", "none". |
| `filename` | string |  | Name for the saved file, without extension |

```json
POST /api/commands/make_prop_sheet
{}
```

### make_iso_tiles

**Isometric tiles**

Render the pieces of a level kit (or other objects) as pixel-art isometric tiles: classic 2:1 diamond view, all at exactly the same scale so they line up on an isometric grid. Give the kit group id (from make_level_kit); its children become the tiles.

| Input | Type | Required | Description |
|---|---|---|---|
| `group` | string |  | A group whose children are the tiles |
| `ids` | list of string |  | Several object ids |
| `tileWidth` | integer |  | Width of one floor diamond in pixels, default 64 Range 16 to 512. |
| `gridSize` | number |  | Size of one grid cell in metres (default 2, like make_level_kit) Range 0.1 to …. |
| `palette` | string or list of string |  | Palette name (see list_palettes) or colours; default the house style palette |
| `filename` | string |  | Name for the saved file, without extension |

```json
POST /api/commands/make_iso_tiles
{}
```

## Picture tools

### list_palettes

**List palettes**

List the built-in pixel-art palettes (use their names wherever a palette is asked for).

_No inputs._

```json
POST /api/commands/list_palettes
{}
```

### remove_background

**Remove background**

Make the plain background of a picture see-through (flood fill from the edges). Creates a new library image. tolerance 0-1: how different a colour may be and still count as background.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `tolerance` | number |  | How different a colour may be and still count as background (0–1, default 0.12) Range 0 to 1. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/remove_background
{"assetId":"asset_1"}
```

### make_seamless

**Make seamless texture**

Turn a photo (stone, grass, wood, fabric...) into a texture that repeats without visible edges. Creates a new library image. Use it with set_material { texture, textureScale } so it tiles at a real-world size.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `blend` | number |  | Width of the blended edge, fraction of the image (default 0.25) Range 0.05 to 0.5. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/make_seamless
{"assetId":"asset_1"}
```

### pixelate_image

**Picture → pixel art**

Turn any picture (photo, drawing, AI image) into pixel art: scaled down to a small size, limited colour palette, crisp edges and an optional outline. Creates a new library image.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `size` | integer |  | Longest side in pixels (default 64) Range 8 to 512. |
| `colors` | integer |  | Default 16 Range 2 to 256. |
| `palette` | string or list of string |  | A palette name (see list_palettes) or a list of colours |
| `outline` | string or null |  | Colour of a 1-pixel outline around the result, or null for none |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/pixelate_image
{"assetId":"asset_1"}
```

### video_to_sprites

**Video → sprite sheet**

Cut a library video into evenly spaced frames and lay them out as a sprite sheet (optionally as pixel art with the background removed). Great after generate_video: an AI-made animation becomes a game sprite. Saves exports/sprites/<filename>.png and adds it to the library.

| Input | Type | Required | Description |
|---|---|---|---|
| `videoId` | string | yes | Id of a video in the library (see list_library) |
| `filename` | string | yes | Name for the saved file, without extension |
| `frames` | integer |  | Default 8 Range 2 to 64. |
| `frameSize` | integer |  | Longest side of one frame, default 96 Range 8 to 1024. |
| `start` | number |  | Start time in seconds Range 0 to …. |
| `end` | number |  | End time in seconds (default: end of video) Range 0 to …. |
| `pixelArt` | boolean |  | Make crisp pixel art (limited colours, hard edges) |
| `colors` | integer |  | How many colours to use when no palette is given Range 2 to 256. |
| `palette` | string or list of string |  | Palette name (see list_palettes, e.g. "pico8") or a list of colours like ["#1a1c2c", "#5d275d"] |
| `removeBackground` | boolean |  | Make the background see-through |

```json
POST /api/commands/video_to_sprites
{"videoId":"video_1","filename":"my_asset"}
```

## Voxels

### edit_voxels

**Edit voxels** · changes the scene (one undo step)

Add, remove or recolour blocks of a voxel object. add/paint = [[x, y, z, "#hex"]], remove = [[x, y, z]]. Coordinates are whole numbers; y is up and y = 0 is the bottom layer. Make a new voxel object with add_object { type: "voxels" }.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `add` | list of list of values |  | Blocks to add: [[x, y, z, "#hex"], …] |
| `remove` | list of list of integer |  | Blocks to remove: [[x, y, z], …] |
| `paint` | list of list of values |  | Blocks to recolour: [[x, y, z, "#hex"], …] |

```json
POST /api/commands/edit_voxels
{"id":"_1"}
```

### voxels_from_image

**Pixel sprite → 3D blocks**

Turn a pixel-art picture into a 3D voxel object: every pixel becomes a block (depth = how many blocks thick). Great for bringing 2D pixel items (swords, potions, coins) into a 3D game. Pictures bigger than maxSize are refused; make them small first with pixelate_image.

| Input | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | yes | Id of a picture in the library (see list_images; ids look like "img_…") |
| `voxelSize` | number |  | Block size in metres, default 0.05 Range 0.001 to 10. |
| `depth` | integer |  | Blocks thick, default 2 Range 1 to 32. |
| `maxSize` | integer |  | Default 96 Range 8 to 256. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/voxels_from_image
{"assetId":"asset_1"}
```

### import_vox

**Import MagicaVoxel**

Import a MagicaVoxel .vox model as a voxel object (editable with edit_voxels). Give exactly one of path, url or data.

| Input | Type | Required | Description |
|---|---|---|---|
| `path` | string |  | A file on the computer running Asset Forge (absolute path). Not allowed for callers on other computers |
| `url` | string |  | An http(s) address to download from |
| `data` | string |  | The file itself as base64, or as a data: URL |
| `voxelSize` | number |  | Size of one block in metres (default 0.05) Range 0.001 to 10. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/import_vox
{}
```

## Library: importing

### import_image

**Import image**

Add a picture (PNG, JPG, WebP, GIF) to the image library so it can be used as a texture or as an image object. Give exactly one of: path (file on this computer), url (http/https), or data (base64 or data: URL). Returns assetId. Set addToScene to also place it in the scene as a flat picture. Tip for AIs with their own image tools (e.g. PixelLab): generate the picture there, then import it here with data or url.

| Input | Type | Required | Description |
|---|---|---|---|
| `path` | string |  | A file on the computer running Asset Forge (absolute path). Not allowed for callers on other computers |
| `url` | string |  | An http(s) address to download from |
| `data` | string |  | The file itself as base64, or as a data: URL |
| `name` | string |  | A readable name (letters, numbers, - and _) |
| `addToScene` | boolean |  | Also place it in the scene as a flat picture |

```json
POST /api/commands/import_image
{}
```

### import_model

**Import 3D model**

Add a ready-made 3D model (.glb, e.g. from Sketchfab, Blender, an AI 3D service or Asset Forge itself) to the library and place it in the scene as a "model" object. Give exactly one of path, url or data. size = height in metres (0 keeps the original size).

| Input | Type | Required | Description |
|---|---|---|---|
| `path` | string |  | A file on the computer running Asset Forge (absolute path). Not allowed for callers on other computers |
| `url` | string |  | An http(s) address to download from |
| `data` | string |  | The file itself as base64, or as a data: URL |
| `name` | string |  | A readable name (letters, numbers, - and _) |
| `addToScene` | boolean |  | Default true |
| `size` | number |  | Height in the scene in metres (0 keeps the original size) Range 0 to 1000. |

```json
POST /api/commands/import_model
{}
```

### list_images

**List images**

List all images in the library (id, name, size, and how AI-made ones were made).

_No inputs._

```json
POST /api/commands/list_images
{}
```

### list_library

**List library**

List everything in the library: images, 3D models and videos.

_No inputs._

```json
POST /api/commands/list_library
{}
```

## Library

### save_asset

**Save to asset library**

Save a finished object to the asset library with a thumbnail, tags and a description, so it can be found (search_library) and placed in any project (place_asset). Tags like "prop", "medieval", "wood", "pixel" make searching easy.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `name` | string |  | A readable name (letters, numbers, - and _) |
| `tags` | list of string |  | Short words to find things by, e.g. ["prop", "wood"] |
| `description` | string |  | A short description in plain words |

```json
POST /api/commands/save_asset
{"id":"_1"}
```

### place_asset

**Place asset**

Place a saved library asset in the current scene.

| Input | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | A readable name (letters, numbers, - and _) |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |

```json
POST /api/commands/place_asset
{"name":"my_asset"}
```

### tag_item

**Tag library item**

Set the tags (and optionally the description or name) of a library asset, image or model.

| Input | Type | Required | Description |
|---|---|---|---|
| `kind` | one of | yes | Which kind of library item: asset, image or model Allowed: "asset", "image", "model". |
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `tags` | list of string |  | Short words to find things by, e.g. ["prop", "wood"] |
| `description` | string |  | A short description in plain words |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/tag_item
{"kind":"asset","id":"_1"}
```

### search_library

**Search library**

Search everything in the library: saved assets, images and 3D models, by words (name, tags, description, the prompt an AI image was made with) and/or tags. Without a query it lists everything, newest first.

| Input | Type | Required | Description |
|---|---|---|---|
| `query` | string |  | Words to look for in names, tags, descriptions and AI prompts |
| `tags` | list of string |  | Short words to find things by, e.g. ["prop", "wood"] |
| `kind` | one of |  | Which kind of library item: asset, image or model Allowed: "asset", "image", "model". |
| `limit` | integer |  | At most this many results (default 100) Range 1 to 500. |

```json
POST /api/commands/search_library
{}
```

### delete_library_item

**Delete from library**

Permanently remove an asset, image or model from the library (its file too). Objects already in scenes that use it lose it. Ask the user first.

| Input | Type | Required | Description |
|---|---|---|---|
| `kind` | one of | yes | Which kind of library item: asset, image or model Allowed: "asset", "image", "model". |
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |

```json
POST /api/commands/delete_library_item
{"kind":"asset","id":"_1"}
```

## Recipes, variations & quality

### get_recipe

**Get recipe**

Show how a generator-made object was made (the generator command and its options). Change the options with remake.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |

```json
POST /api/commands/get_recipe
{"id":"_1"}
```

### remake

**Re-make with changes**

Rebuild a generator-made object with changed options, e.g. remake { id, changes: { wear: 0.8, woodColor: "#7a5030" } } or a new seed. It keeps its place, rotation, scale and name. Use get_recipe to see the options.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `changes` | object |  | Generator options to change, e.g. { "wear": 0.8 } |

```json
POST /api/commands/remake
{"id":"_1"}
```

### save_recipe

**Save as recipe**

Store an object (with everything inside it, its materials, cuts and animations) as a reusable template in the library, so it can be placed again in any project with use_recipe. Generator-made objects are stored as their generator options.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/save_recipe
{"id":"_1"}
```

### use_recipe

**Place a recipe**

Place a saved recipe (template) in the current scene. See list_recipes.

| Input | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | A readable name (letters, numbers, - and _) |
| `position` | list of number |  | Position [x, y, z] in metres; y is up, y = 0 is the ground Exactly 3 values. |
| `changes` | object |  | Generator recipes only: change options |

```json
POST /api/commands/use_recipe
{"name":"my_asset"}
```

### list_recipes

**List recipes**

List the saved recipes (templates) in the library.

_No inputs._

```json
POST /api/commands/list_recipes
{}
```

### make_variations

**Make variations**

Make several versions of an object side by side so the best one can be picked. Generator-made objects are rebuilt with new seeds (and optionally other values from "vary", e.g. { "style": ["round", "pine"] }); other objects get new pattern variants and small colour and size changes. Returns a picture of all of them, numbered left to right, top to bottom. Pick one with keep_variation.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |
| `count` | integer |  | Default 6 Range 2 to 24. |
| `vary` | object |  | Generator options to vary, e.g. { "style": ["round", "pine"] } |
| `columns` | integer |  | How many side by side per row Range 1 to 8. |

```json
POST /api/commands/make_variations
{"id":"_1"}
```

### keep_variation

**Keep this variation**

Keep one variation: it takes the place of the original, and the original and the other variations are removed.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |

```json
POST /api/commands/keep_variation
{"id":"_1"}
```

### check_quality

**Quality check**

Look for problems before delivering assets: floating or loose parts, objects sinking into the ground, odd sizes, too many polygons for a game, missing pictures, and beauty tips (sharp box edges, pure black/white, mirror-smooth metal). Returns a score out of 100 and a list of issues with fixes.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string |  | Check one object; default all top-level objects |

```json
POST /api/commands/check_quality
{}
```

## House styles

### list_house_styles

**List house styles**

List house styles: built-in ones and your own saved ones. A house style keeps every asset of one game looking like a family.

_No inputs._

```json
POST /api/commands/list_house_styles
{}
```

### save_house_style

**Save house style**

Save a house style: a colour palette plus lighting, style and effects. Without explicit values it takes the current scene's look and (if no palette is given) the most used colours in the scene.

| Input | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | A readable name (letters, numbers, - and _) |
| `description` | string |  | A short description in plain words |
| `palette` | list of string |  | The colours of the style; default the most used colours in the scene |
| `lighting` | one of |  | Lighting preset to store with the style Allowed: "studio", "product", "outdoor", "sunset", "night", "dramatic". |
| `style` | one of |  | Scene style to store with the style Allowed: "realistic", "toon", "lowpoly", "clay". |

```json
POST /api/commands/save_house_style
{"name":"my_asset"}
```

### apply_house_style

**Apply house style** · changes the scene (one undo step)

Apply a house style to the scene: its lighting, style and effects, and (recolor, default true) snap every material colour to the nearest palette colour. While a house style is active, sprite sheets, tilesets and pixel art use its palette unless another palette is given.

| Input | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | A readable name (letters, numbers, - and _) |
| `recolor` | boolean |  | Also snap every material colour to the nearest palette colour (default true) |

```json
POST /api/commands/apply_house_style
{"name":"my_asset"}
```

## AI services

### list_ai_services

**List AI services**

Show which outside AI services are connected and what they can make (image, video, 3d) with suggested model names. These services cost money per use on the user's own account.

_No inputs._

```json
POST /api/commands/list_ai_services
{}
```

### connect_ai_service

**Connect AI service**

Save an API key (and optionally a different server address) for a service. Normally the user does this in the window (✨ AI → Services). Send an empty key to disconnect.

| Input | Type | Required | Description |
|---|---|---|---|
| `service` | one of | yes | Which AI service to use (see list_ai_services) Allowed: "openai", "google", "nanogpt", "pixellab", "fal". |
| `key` | string |  | The API key from the service's website; an empty string disconnects |
| `baseUrl` | string |  | Only for a different server address (proxies, test servers); leave out normally |

```json
POST /api/commands/connect_ai_service
{"service":"openai"}
```

### generate_image

**Generate image with AI**

Make a picture with an outside AI image model and add it to the library. Services: openai (gpt-image), google (Nano Banana), nanogpt (many models). references = library image ids the AI should follow (edit or restyle them). referenceRender renders a scene object first and sends that as reference — great for "repaint this 3D model as pixel art / hand-painted". Then use it as texture, place it, or make a 3D cut-out. Costs money on the user's account.

| Input | Type | Required | Description |
|---|---|---|---|
| `service` | one of | yes | Which AI service to use (see list_ai_services) Allowed: "openai", "google", "nanogpt", "pixellab". |
| `prompt` | string | yes | What to make, in plain words |
| `model` | string |  | Model name; see list_ai_services for suggestions |
| `size` | string |  | openai/nanogpt: e.g. "1024x1024"; google: aspect ratio like "1:1", "16:9" or size "1K"/"2K"/"4K" |
| `transparent` | boolean |  | See-through background (openai natively; others get a white background removed afterwards) |
| `references` | list of string |  | Library picture ids the AI should follow, restyle or edit |
| `referenceRender` | object |  | Render this object ({ target, view }) and send it as reference, e.g. to repaint a 3D model as pixel art |
| `name` | string |  | A readable name (letters, numbers, - and _) |
| `place` | one of |  | Also put it in the scene as a flat picture or a 3D cut-out Allowed: "none", "image", "cutout". |
| `textureFor` | string |  | Object id to paint the picture onto |

```json
POST /api/commands/generate_image
{"service":"openai","prompt":"a wooden treasure chest"}
```

### generate_video

**Generate video with AI**

Make a short video with an outside AI video model (nanogpt: Veo, Kling, Wan, Seedance...). Give image (a library image id) to animate a picture. Takes one to several minutes. The video goes into the library; turn it into a sprite animation with video_to_sprites. Costs money on the user's account.

| Input | Type | Required | Description |
|---|---|---|---|
| `service` | one of | yes | Which AI service to use (see list_ai_services) Allowed: "nanogpt". |
| `prompt` | string | yes | What to make, in plain words |
| `model` | string |  | Model name of the service; leave out for its default (see list_ai_services for suggestions) |
| `image` | string |  | Library image id to start from (image-to-video) |
| `duration` | integer |  | Seconds, model dependent (often 5) Range 1 to 20. |
| `aspect` | string |  | e.g. "16:9", "1:1" |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/generate_video
{"service":"nanogpt","prompt":"a wooden treasure chest"}
```

### generate_3d

**Generate 3D model with AI**

Make a textured 3D model with an outside AI (fal: Trellis 2 or Hunyuan 3D) from a picture (image = library image id; best with one object on a plain background) or from text (prompt with a text-to-3d model). The model is added to the library and placed in the scene. Takes a few minutes. Costs money on the user's account.

| Input | Type | Required | Description |
|---|---|---|---|
| `service` | one of | yes | Which AI service to use (see list_ai_services) Allowed: "fal". |
| `image` | string |  | Library picture to turn into 3D (one object on a plain background works best) |
| `prompt` | string |  | What to make, in plain words |
| `model` | string |  | Model name of the service; leave out for its default (see list_ai_services for suggestions) |
| `size` | number |  | Height in metres in the scene (default 1) Range 0 to 1000. |
| `name` | string |  | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/generate_3d
{"service":"fal"}
```

## PixelLab (all tools)

### pixellab_tools

**PixelLab tools**

List every tool PixelLab offers (images, characters in 4/8 directions, animations, tilesets, isometric tiles, UI, fonts, effects, editing...), read live from PixelLab's own specification. Use pixellab_tool_info to see all settings of one tool and pixellab_run to use it. Needs a connected PixelLab key.

| Input | Type | Required | Description |
|---|---|---|---|
| `category` | string |  | Only tools in this group (e.g. "tiles", "animation") |
| `refresh` | boolean |  | Reload the list from PixelLab |

```json
POST /api/commands/pixellab_tools
{}
```

### pixellab_tool_info

**PixelLab tool settings**

All settings of one PixelLab tool with their descriptions, allowed values, defaults and limits (as a JSON schema). Fields marked x-image take a picture: give a library image id ("img_..."), or { "render": "<object id>" } to send a render of a 3D object.

| Input | Type | Required | Description |
|---|---|---|---|
| `tool` | string | yes | Tool name from pixellab_tools, e.g. "create-image-pixflux" |

```json
POST /api/commands/pixellab_tool_info
{"tool":"example"}
```

### pixellab_run

**Run PixelLab tool**

Run any PixelLab tool with any of its settings (see pixellab_tool_info). Pictures go in as library ids or { render: objectId }. Long jobs (characters, animations, tilesets...) are followed until finished. Every picture in the result is added to the library; the first one is returned so you can look at it. This costs PixelLab generations or credits: ask the user first.

| Input | Type | Required | Description |
|---|---|---|---|
| `tool` | string | yes | Tool name from pixellab_tools, e.g. "create-image-pixflux" |
| `params` | object |  | The tool's settings, exactly as pixellab_tool_info lists them |
| `pathParams` | object |  | For tools with an id in their address, e.g. { "object_id": "..." } |
| `name` | string |  | Base name for the pictures in the library |

```json
POST /api/commands/pixellab_run
{"tool":"example"}
```

### pixellab_balance

**PixelLab balance**

Show the remaining PixelLab credits and subscription generations (free to call).

_No inputs._

```json
POST /api/commands/pixellab_balance
{}
```

## Projects, versions & backups

### list_projects

**List projects**

List saved projects. Projects save automatically after every change.

_No inputs._

```json
POST /api/commands/list_projects
{}
```

### new_project

**New project**

Start a new, empty project. The current project is saved first.

| Input | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/new_project
{"name":"my_asset"}
```

### open_project

**Open project**

Open a saved project.

| Input | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/open_project
{"name":"my_asset"}
```

### save_project_as

**Save project as**

Save the current scene under a new project name and continue working in that copy.

| Input | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | A readable name (letters, numbers, - and _) |

```json
POST /api/commands/save_project_as
{"name":"my_asset"}
```

### list_versions

**Version history**

List saved versions of the current project (newest first). Versions are made automatically every few minutes while working, before big changes (clearing, loading, switching, restoring), and by hand with save_checkpoint.

| Input | Type | Required | Description |
|---|---|---|---|
| `project` | string |  | Project name (default: the open project) |

```json
POST /api/commands/list_versions
{}
```

### save_checkpoint

**Save checkpoint**

Save the current project as a named version you can go back to (e.g. before a big experiment). Checkpoints are never cleaned up automatically.

| Input | Type | Required | Description |
|---|---|---|---|
| `note` | string |  | A short note to recognise it by later |

```json
POST /api/commands/save_checkpoint
{}
```

### restore_version

**Restore version**

Go back to an earlier version of the current project (see list_versions). The current state is saved as a version first, so this can be undone.

| Input | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the object to work on (see get_scene; ids look like "box_1") |

```json
POST /api/commands/restore_version
{"id":"_1"}
```

### backup_now

**Back up everything**

Copy all projects, the library and the version history into a dated backup folder (next to the workspace, "workspace-backups"; the last 7 are kept). A backup is also made automatically once a day. Give "to" for a different folder, e.g. a USB stick.

| Input | Type | Required | Description |
|---|---|---|---|
| `to` | string |  | A different folder for the backup, e.g. a USB stick (default: workspace-backups) |

```json
POST /api/commands/backup_now
{}
```

## Help

### list_commands

**List commands**

List every available command (including plugin commands). Pass withSchemas to include input schemas.

| Input | Type | Required | Description |
|---|---|---|---|
| `withSchemas` | boolean |  | Also return every command's input schema |

```json
POST /api/commands/list_commands
{}
```

### list_presets

**List presets**

List material presets, generated patterns, styles and lighting presets.

_No inputs._

```json
POST /api/commands/list_presets
{}
```

### list_plugins

**List plugins**

List loaded plugins.

_No inputs._

```json
POST /api/commands/list_plugins
{}
```

### open_window

**Open window**

Open the Asset Forge window in the default web browser so the user can watch live.

_No inputs._

```json
POST /api/commands/open_window
{}
```
