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
6. ALWAYS check your work with render_preview (try iso and front views) and fix gaps, floating parts and proportions before declaring it done.
7. Use run_batch to build many parts in one step ($N.id references earlier results).
8. Deliver with export_glb (3D model) and/or export_png (picture). Files land in the workspace/exports folder.`;

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
