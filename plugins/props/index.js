// Prop generator library: each generator builds a complete, ready-to-use object from
// parts, with options and a seed for variations.
import * as containers from './containers.js';
import * as nature from './nature.js';
import * as items from './items.js';
import * as structures from './structures.js';
import * as levelkit from './levelkit.js';
import * as character from './character.js';

export const description = 'Generators: barrel, chest, rock, tree, crystal, potion, sword, coin, lamp post, fence, level kit, character.';

export default function register({ registry, z, engine }) {
  for (const mod of [containers, nature, items, structures, levelkit, character]) mod.register(registry, z, engine);
}
