#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ensureEngine, listCommands, call } from '../client.js';
import { AI_GUIDE, API_NOTES } from '../shared/ai-guide.js';

// MCP bridge: exposes every engine command (including plugin commands) as an MCP tool.
// Claude Code, Claude Desktop, Cursor and other MCP clients connect here.
const INSTRUCTIONS = `${AI_GUIDE}\n\n${API_NOTES}`;
const READ_ONLY = /^(get_|list_|search_|check_|render_preview$|pixellab_tools$|pixellab_tool_info$|pixellab_balance$)/;

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
      // Only commands that just look (and cost nothing) count as read-only: MCP apps may run
      // read-only tools without asking, and generators, files and paid AI services must not be.
      annotations: { readOnlyHint: !c.mutates && READ_ONLY.test(c.name) },
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
