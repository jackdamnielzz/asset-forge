#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ensureEngine, listCommands, call } from '../client.js';

// MCP bridge: exposes every engine command (including plugin commands) as an MCP tool.
// Claude Code, Claude Desktop, Cursor and other MCP clients connect here.
const INSTRUCTIONS = `Asset Forge is a 3D asset creation tool. The user may be watching the window live (call open_window if they want to see it).
Units are metres, Y is up, rotation in degrees. Objects rest on the ground by default.
How to make beautiful assets:
1. Start with get_scene. Use clear_scene or new_project for a fresh start.
2. Build from several well-proportioned parts; group them with a "group" object (parent) so they move and export together.
3. Boxes: keep a small bevel (0.01-0.05) - rounded edges catch light and look real.
4. Use material presets, then tune colour/roughness. Avoid pure black/white; vary roughness between parts.
   Presets with generated surfaces (oak, floor_planks, old_wood, brushed_steel, worn_metal, rusty_metal, cobblestone,
   brick_wall, floor_tiles, cloth, concrete, hand_painted) look far richer than plain colours. Tune them with
   set_material pattern {scale (metres per tile), seed, variation, bump, angle 90 for upright wood} and wear (0-1 age).
5. Pick lighting with set_environment (studio for judging, others for mood). set_style switches the whole look
   (realistic, toon, lowpoly, clay - clay is great for checking shapes). set_effects controls soft shadows and glow.
6. Ready-made generators build whole props in one call: make_barrel, make_chest, make_rock, make_tree, make_crystal,
   make_potion, make_sword, make_coin, make_lamp_post, make_fence, make_crate (options + seed for variations).
   Advanced shapes: lathe (spin a [radius, y] profile: bottles, vases, columns), extrude (flat outline with depth:
   blades, signs), text, rock, cutout (an imported picture's outline as a solid). Modelling: cut_object
   (subtract/union/intersect: holes, windows, grooves), mirror_object (symmetry), repeat_object (line/circle/grid).
7. ALWAYS check your work with render_preview (try iso and front views) and fix gaps, floating parts and proportions before declaring it done.
8. Use run_batch to build many parts in one step ($N.id references earlier results).
   Games: animate_object (spin, bob, pulse, swing, hinge, shake, hop) or set_keyframes add movement;
   render_sprites turns an object into a pixel-art sprite sheet (directions x frames); make_icons renders
   matching inventory icons; export_godot / export_each write .glb files with collision and animations into a
   Godot project; make_level_kit builds snapping floor/wall/door/window/pillar/stairs pieces.
   Pixel art: make_character (with idle/walk/run/attack/jump), render_sprites with palette (list_palettes), dither,
   outlineStyle "selout", maps ["normal"] and project (Godot SpriteFrames); make_tileset (autotiles + Godot TileSet);
   pixelate_image turns any picture into pixel art. More 2D: make_effect (explosion, fire, smoke, magic, sparks,
   glitter, heal, lightning), make_parallax, make_prop_sheet, make_iso_tiles, paint_pixels, recolor_image,
   make_palette_variants, extract_palette, check_pixel_style, export_aseprite. Voxels: add_object type "voxels",
   edit_voxels, voxels_from_image, import_vox.
   AI services (cost the user money, ask first): generate_image (openai, google Nano Banana, nanogpt), generate_video
   (nanogpt), generate_3d (fal). If you have your own image tools, make the picture there and import_image it.
   Free picture tools: remove_background, make_seamless, video_to_sprites, import_model (.glb).
9. Iterate smartly: remake changes a generator-made object's options in place; make_variations shows several
   versions (pick with keep_variation); check_quality before delivering; apply_house_style keeps a game consistent.
10. Deliver with export_glb (3D model) and/or export_png (picture). Files land in the workspace/exports folder.`;

const server = new Server({ name: 'asset-forge', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  await ensureEngine();
  const commands = await listCommands();
  return {
    tools: commands.map((c) => ({
      name: c.name,
      title: c.title,
      description: c.description,
      inputSchema: { type: 'object', ...c.inputSchema },
      annotations: { readOnlyHint: !c.mutates && !/^(export|import|new_|open_|save_|undo|redo|run_batch|open_window)/.test(c.name) },
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    await ensureEngine();
    const result = await call(req.params.name, req.params.arguments ?? {}, 'mcp');
    if (result && typeof result.image === 'string') {
      const { image, mime, ...rest } = result;
      return { content: [{ type: 'image', data: image, mimeType: mime ?? 'image/png' }, { type: 'text', text: JSON.stringify(rest) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
});

await server.connect(new StdioServerTransport());
