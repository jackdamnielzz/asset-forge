// The guide for AIs using Asset Forge. Shared by the MCP server, llms.txt, the OpenAPI file
// and the API reference, so every way in tells the same story. No imports allowed here.

export const AI_GUIDE = `Asset Forge is a 3D and pixel-art asset creation tool that AIs drive completely through commands.
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
  unless a Godot project folder is given.`;

export const API_NOTES = `HOW TO CALL
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
  command as an MCP tool.`;
