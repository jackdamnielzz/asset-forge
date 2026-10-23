# Asset Forge — instructions for AI agents

Asset Forge is an AI-controllable 3D and pixel-art asset creation tool. You can drive **everything** it does
through its API; a person may be watching the window live.

## Read first

| What | Where (running engine) | In this repository |
|---|---|---|
| Short guide for AIs + list of all commands | `http://127.0.0.1:7777/llms.txt` | [llms.txt](llms.txt) |
| Every command and every setting, with examples | `http://127.0.0.1:7777/docs` (searchable page) or `/docs/api.md` | [docs/API.md](docs/API.md) |
| Machine-readable description (OpenAPI 3.1) | `http://127.0.0.1:7777/api/openapi.json` | [docs/openapi.json](docs/openapi.json) |
| Live command list with JSON schemas | `GET http://127.0.0.1:7777/api/commands` | — |

The live versions always match the running software; the repository copies are refreshed with `npm run docs`.

## Ways to connect

- **MCP** (Claude Code, Claude Desktop, Cursor, …): `node src/mcp/index.js` gives every command as an MCP tool and
  starts the engine if needed. In this folder Claude Code picks it up from `.mcp.json`.
- **HTTP** (any AI, script or tool): `POST /api/commands/<name>` with a JSON body; answers `{ "ok": true, "result": … }`.
  OpenAPI-aware tools (ChatGPT actions, LangChain, n8n, …) can import `/api/openapi.json` directly.
- **Command line**: `node src/cli/forge.js <command> key=value …` or `… @args.json`.
- **Shared Asset Forge on another computer**: use `http://<address>:7777` and send `Authorization: Bearer <password>`
  (for MCP/CLI: set `FORGE_URL` and `FORGE_PASSWORD`). From other computers, file paths (`path`, `project`, `to`)
  and AI-service settings are not allowed, and a `url` must be a public address (not that computer or its network);
  send `data` instead. These limits also apply inside `run_batch`. Five wrong passwords lock that address for a minute.

## Golden rules

1. Call `get_scene` first; look at your work with `render_preview` before saying it is done.
2. Commands that use outside AI services (`generate_image`, `generate_video`, `generate_3d`, `pixellab_run`) cost the
   user money: ask first.
3. `save_checkpoint` before big experiments; `restore_version` goes back.

Developers changing the code: see [CLAUDE.md](CLAUDE.md) for the architecture rules.
