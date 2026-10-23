// Prop generator library: each generator builds a complete, ready-to-use object from
// parts, with options and a seed for variations.
import * as containers from './containers.js';
import * as nature from './nature.js';
import * as items from './items.js';
import * as structures from './structures.js';

export const description = 'Generators: barrel, chest, rock, tree, crystal, potion, sword, coin, lamp post, fence.';

export default function register({ registry, z, engine }) {
  for (const mod of [containers, nature, items, structures]) mod.register(registry, z, engine);
}
