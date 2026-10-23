import { z } from 'zod';
import { describeParam } from './param-docs.js';

// The command registry is the single "menu" of everything Asset Forge can do.
// The window, the HTTP API, the MCP server and the CLI all call commands from here,
// so a command added here (by core or by a plugin) is instantly available everywhere.
export class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  define(def) {
    if (!def.name || !/^[a-z][a-z0-9_]*$/.test(def.name)) throw new Error(`Invalid command name: ${def.name}`);
    if (this.commands.has(def.name)) throw new Error(`Command already defined: ${def.name}`);
    this.commands.set(def.name, {
      category: 'general',
      mutates: false,
      input: z.object({}),
      ...def,
    });
  }

  has(name) {
    return this.commands.has(name);
  }

  list() {
    return [...this.commands.values()].map((c) => {
      const inputSchema = toJsonSchema(c.input);
      // fill in explanations for inputs that do not carry their own
      for (const [k, p] of Object.entries(inputSchema.properties ?? {})) {
        if (!p.description) {
          const d = describeParam(c.name, k);
          if (d) p.description = d;
        }
      }
      return { name: c.name, title: c.title ?? c.name, description: c.description, category: c.category, mutates: c.mutates, inputSchema };
    });
  }

  async execute(name, args, ctx) {
    const cmd = this.commands.get(name);
    if (!cmd) throw new CommandError(`Unknown command "${name}". Call list_commands to see what exists.`);
    const parsed = cmd.input.safeParse(args ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`).join('; ');
      throw new CommandError(`Invalid input for ${name}: ${issues}`);
    }
    return cmd.handler(parsed.data, ctx);
  }
}

export class CommandError extends Error {}

function toJsonSchema(schema) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  delete json.$schema;
  return json;
}
