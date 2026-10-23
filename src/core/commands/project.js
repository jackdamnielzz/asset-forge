import fs from 'node:fs/promises';
import { emptyScene, safeName } from '../engine.js';
import { CommandError } from '../registry.js';
import { checkScene } from './common.js';

export function register(registry, { z, engine }) {
  const readProject = async (name) => {
    try { return JSON.parse(await fs.readFile(engine.projectFile(name), 'utf8')); } catch { return null; }
  };

  registry.define({
    name: 'list_projects',
    title: 'List projects',
    category: 'project',
    description: 'List saved projects. Projects save automatically after every change.',
    async handler() {
      const files = await fs.readdir(engine.paths.projects);
      return { current: engine.scene.name, projects: files.filter((f) => f.endsWith('.forge.json')).map((f) => f.replace(/\.forge\.json$/, '')) };
    },
  });

  registry.define({
    name: 'new_project',
    title: 'New project',
    category: 'project',
    description: 'Start a new, empty project. The current project is saved first.',
    input: z.object({ name: z.string() }),
    async handler({ name }) {
      const clean = safeName(name);
      if (await readProject(clean)) throw new CommandError(`Project "${clean}" already exists. Use open_project.`);
      await engine.loadScene(emptyScene(clean));
      return { project: clean };
    },
  });

  registry.define({
    name: 'open_project',
    title: 'Open project',
    category: 'project',
    description: 'Open a saved project.',
    input: z.object({ name: z.string() }),
    async handler({ name }) {
      const clean = safeName(name);
      const found = await readProject(clean);
      if (!found) throw new CommandError(`No project named "${name}". Call list_projects.`);
      // the file name decides where it saves, even if the name inside the file differs (a copied file)
      const scene = checkScene({ ...found, name: clean });
      await engine.loadScene(scene);
      return { project: scene.name, objects: scene.order.length };
    },
  });

  registry.define({
    name: 'save_project_as',
    title: 'Save project as',
    category: 'project',
    description:
      'Save the current scene under a new project name and continue working in that copy. ' +
      'Refuses a name that is already taken, unless overwrite is true (the old project is then kept as a version first).',
    input: z.object({ name: z.string(), overwrite: z.boolean().optional().describe('Replace an existing project with this name') }),
    handler({ name, overwrite = false }) {
      const clean = safeName(name);
      return engine.exclusive(async () => {
        if (clean === engine.scene.name) { await engine.saveCurrent(); return { project: clean }; }
        const existing = await readProject(clean);
        if (existing && !overwrite) throw new CommandError(`Project "${clean}" already exists. Choose another name, or pass overwrite: true to replace it.`);
        if (existing) await engine.history.save({ ...existing, name: clean }, 'safety', 'before being overwritten by save_project_as');
        engine.scene.name = clean;
        await engine.saveCurrent();
        engine.changed();
        return { project: clean };
      });
    },
  });
}
