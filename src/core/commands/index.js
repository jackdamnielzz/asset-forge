import * as objects from './objects.js';
import * as scene from './scene.js';
import * as assets from './assets.js';
import * as project from './project.js';
import * as render from './render.js';
import * as modeling from './modeling.js';

export function registerBuiltins(registry, api) {
  for (const mod of [scene, objects, modeling, assets, project, render]) mod.register(registry, api);
}
