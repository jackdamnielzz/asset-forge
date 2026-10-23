import * as objects from './objects.js';
import * as scene from './scene.js';
import * as assets from './assets.js';
import * as project from './project.js';
import * as render from './render.js';
import * as modeling from './modeling.js';
import * as animation from './animation.js';
import * as game from './game.js';
import * as ai from './ai.js';
import * as tiles from './tiles.js';
import * as superpowers from './superpowers.js';
import * as pixel2d from './pixel2d.js';
import * as voxels from './voxels.js';
import * as library from './library.js';
import * as history from './history.js';

export function registerBuiltins(registry, api) {
  for (const mod of [scene, objects, modeling, animation, assets, ai, project, render, game, tiles, superpowers, pixel2d, voxels, library, history]) mod.register(registry, api);
}
