import { CommandError } from '../registry.js';
import { checkScene } from './common.js';

export function register(registry, { z, engine }) {
  registry.define({
    name: 'list_versions',
    title: 'Version history',
    category: 'project',
    description:
      'List saved versions of the current project (newest first). Versions are made automatically every few minutes while working, ' +
      'before big changes (clearing, loading, switching, restoring), and by hand with save_checkpoint.',
    input: z.object({ project: z.string().optional() }),
    handler: ({ project }) => engine.history.list(project ?? engine.scene.name),
  });

  registry.define({
    name: 'save_checkpoint',
    title: 'Save checkpoint',
    category: 'project',
    description: 'Save the current project as a named version you can go back to (e.g. before a big experiment). Checkpoints are never cleaned up automatically.',
    input: z.object({ note: z.string().max(200).optional() }),
    async handler({ note = '' }) {
      await engine.saveCurrent();
      const id = await engine.history.save(engine.scene, 'checkpoint', note);
      return { id };
    },
  });

  registry.define({
    name: 'restore_version',
    title: 'Restore version',
    category: 'project',
    description: 'Go back to an earlier version of the current project (see list_versions). The current state is saved as a version first, so this can be undone.',
    input: z.object({ id: z.string() }),
    async handler({ id }) {
      let scene;
      try { scene = await engine.history.read(engine.scene.name, id); } catch { throw new CommandError(`No version "${id}". See list_versions.`); }
      scene = checkScene({ ...scene, name: engine.scene.name });
      delete scene._version;
      await engine.loadScene(scene);
      return { restored: id, objects: scene.order.length };
    },
  });

  registry.define({
    name: 'backup_now',
    title: 'Back up everything',
    category: 'project',
    description:
      'Copy all projects, the library and the version history into a dated backup folder (next to the workspace, "workspace-backups"; the last 7 are kept). ' +
      'A backup is also made automatically once a day. Give "to" for a different folder, e.g. a USB stick.',
    input: z.object({ to: z.string().optional() }),
    async handler({ to }) {
      await engine.saveCurrent();
      return { folder: await engine.history.backup(to) };
    },
  });
}
