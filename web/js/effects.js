import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Builds the chain of picture effects: soft corner shadows (ambient occlusion),
// glow (bloom) and the final colour/brightness step.
export function createComposer(renderer, scene, camera, width, height, fx, sceneRadius) {
  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const passes = {};
  if (fx.ao) {
    const ao = new GTAOPass(scene, camera, width, height);
    ao.output = GTAOPass.OUTPUT.Default;
    composer.addPass(ao);
    passes.ao = ao;
  }
  if (fx.bloom) {
    passes.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), fx.bloomStrength, 0.45, fx.bloomThreshold);
    composer.addPass(passes.bloom);
  }
  composer.addPass(new OutputPass());
  const result = { composer, passes, key: null };
  tuneComposer(result, fx, sceneRadius);
  return result;
}

export function tuneComposer({ passes }, fx, sceneRadius) {
  if (passes.ao) {
    passes.ao.blendIntensity = fx.aoStrength;
    passes.ao.updateGtaoMaterial({ radius: Math.max(0.05, sceneRadius * 0.22), distanceExponent: 1.2, thickness: 1, scale: 1, samples: 16 });
    passes.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
  }
  if (passes.bloom) {
    passes.bloom.strength = fx.bloomStrength;
    passes.bloom.threshold = fx.bloomThreshold;
  }
}

export function disposeComposer(c) {
  if (!c) return;
  for (const pass of c.composer.passes) pass.dispose?.();
  c.composer.dispose();
}

// The effects chain applies filmic tone mapping to the whole frame, which would
// also change the background colour. To keep the background exactly the colour
// the user picked, we look for the input colour that maps onto it.
export function compensateBackground(srgbHex, exposure) {
  const target = new THREE.Color(srgbHex); // linear working space
  const want = [target.r, target.g, target.b].map(linearToSrgb);
  let x = [target.r, target.g, target.b];
  for (let i = 0; i < 40; i++) {
    const got = acesToSrgb(x, exposure);
    let done = true;
    x = x.map((v, k) => {
      const err = want[k] - got[k];
      if (Math.abs(err) > 0.0005) done = false;
      return Math.max(0, v + err * Math.max(0.05, v * 2 + 0.05));
    });
    if (done) break;
  }
  return new THREE.Color().setRGB(x[0], x[1], x[2], THREE.LinearSRGBColorSpace);
}

// Same maths as three.js ACESFilmicToneMapping, followed by sRGB encoding.
function acesToSrgb(rgb, exposure) {
  let [r, g, b] = rgb.map((v) => (v * exposure) / 0.6);
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ig = 0.07600 * r + 0.90834 * g + 0.01566 * b;
  const ib = 0.02840 * r + 0.13383 * g + 0.83777 * b;
  const fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  const [fr, fg, fb] = [fit(ir), fit(ig), fit(ib)];
  r = 1.60475 * fr - 0.53108 * fg - 0.07367 * fb;
  g = -0.10208 * fr + 1.10813 * fg - 0.00605 * fb;
  b = -0.00327 * fr - 0.07276 * fg + 1.07602 * fb;
  return [r, g, b].map((v) => linearToSrgb(Math.min(1, Math.max(0, v))));
}

function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
