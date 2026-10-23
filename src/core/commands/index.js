import * as objects from './objects.js';
import * as scene from './scene.js';
import * as assets from './assets.js';
import * as project from './project.js';
import * as render from './render.js';
import * as modeling from './modeling.js';
import * as animation from './animation.js';
import * as game from './game.js';

export function registerBuiltins(registry, api) {
  for (const mod of [scene, objects, modeling, animation, assets, project, render, game]) mod.register(registry, api);
}
