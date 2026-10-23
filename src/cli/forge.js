#!/usr/bin/env node
import fs from 'node:fs/promises';
import { ensureEngine, listCommands, call, BASE } from '../client.js';

const HELP = `Asset Forge command line

  forge list                         show all commands
  forge help <command>               show a command's inputs
  forge <command> [key=value ...]    run a command (values may be JSON)
  forge <command> '{"json":"args"}'  run a command with JSON args
  forge run <recipe.json>            run a recipe ({"commands":[...]} or a full scene)
  forge start                        start the engine and open the window

  --out <file.png>   save the image returned by render_preview

Examples:
  forge add_object type=box params='{"bevel":0.05}' material='{"preset":"gold"}'
  forge render_preview view=front --out preview.png
`;

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv.splice(outIdx, 2)[1] : null;
const [cmd, ...rest] = argv;

try {
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
  } else if (cmd === 'start') {
    await ensureEngine({ open: true });
    console.log(`Asset Forge is running at ${BASE}`);
  } else if (cmd === 'list') {
    await ensureEngine();
    const commands = await listCommands();
    for (const c of commands) console.log(`${c.name.padEnd(18)} ${c.description.split('. ')[0]}`);
  } else if (cmd === 'help') {
    await ensureEngine();
    const c = (await listCommands()).find((x) => x.name === rest[0]);
    if (!c) throw new Error(`Unknown command ${rest[0]}`);
    console.log(`${c.name}\n\n${c.description}\n\nInputs:\n${JSON.stringify(c.inputSchema.properties ?? {}, null, 2)}`);
  } else if (cmd === 'run') {
    await ensureEngine();
    const recipe = JSON.parse(await fs.readFile(rest[0], 'utf8'));
    const result = recipe.commands
      ? await call('run_batch', { commands: recipe.commands }, 'cli')
      : await call('load_scene', { scene: recipe }, 'cli');
    console.log(JSON.stringify(result, null, 2));
  } else {
    await ensureEngine();
    const result = await call(cmd, parseArgs(rest), 'cli');
    if (result?.image) {
      if (out) {
        await fs.writeFile(out, Buffer.from(result.image, 'base64'));
        console.log(`Saved ${out}`);
      }
      delete result.image;
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

function parseArgs(list) {
  if (list.length === 1 && list[0].trim().startsWith('{')) return JSON.parse(list[0]);
  const args = {};
  for (const item of list) {
    const eq = item.indexOf('=');
    if (eq < 0) throw new Error(`Expected key=value, got "${item}"`);
    const key = item.slice(0, eq);
    const raw = item.slice(eq + 1);
    try { args[key] = JSON.parse(raw); } catch { args[key] = raw; }
  }
  return args;
}
