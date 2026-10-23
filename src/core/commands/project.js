import fs from 'node:fs/promises';
import { emptyScene, safeName } from '../engine.js';
import { CommandError } from '../registry.js';

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
      const scene = await readProject(safeName(name));
      if (!scene) throw new CommandError(`No project named "${name}". Call list_projects.`);
      await engine.loadScene(scene);
      return { project: scene.name, objects: scene.order.length };
    },
  });

  registry.define({
    name: 'save_project_as',
    title: 'Save project as',
    category: 'project',
    description: 'Save the current scene under a new project name and continue working in that copy.',
    input: z.object({ name: z.string() }),
    async handler({ name }) {
      const clean = safeName(name);
      engine.scene.name = clean;
      await engine.saveCurrent();
      engine.changed();
      return { project: clean };
    },
  });
}
