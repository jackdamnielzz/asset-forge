import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { LIGHTING_PRESETS, PATTERNS, DEFAULT_EFFECTS, DEFAULT_STYLE_OPTIONS } from '/shared/presets.js';
import { createComposer, tuneComposer, disposeComposer, compensateBackground } from './effects.js';
import { generatePattern } from './patterns.js';

const DEG = Math.PI / 180;

const VIEW_DIRS = {
  iso: [1, 0.72, 1.3],
  iso_back: [-1, 0.72, -1.3],
  front: [0, 0.12, 1],
  back: [0, 0.12, -1],
  left: [-1, 0.12, 0],
  right: [1, 0.12, 0],
  top: [0, 1, 0.0001],
};

// Turns the engine's scene description into a three.js scene, and can render
// pictures and export GLB files from it. Used by the window and by the hidden renderer.
export class SceneView {
  constructor(canvas, { interactive = true } = {}) {
    this.canvas = canvas;
    this.interactive = interactive;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !interactive });
    this.renderer.setPixelRatio(interactive ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.content = new THREE.Group();
    this.content.name = 'content';
    this.helpers = new THREE.Group();
    this.lights = new THREE.Group();
    this.scene.add(this.content, this.helpers, this.lights);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
    this.camera.position.set(3.2, 2.4, 4.2);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envCache = new Map();
    this.textureCache = new Map();
    this.patternCache = new Map();
    this.gradientCache = new Map();
    this.pendingLoads = new Set();
    this.nodes = new Map(); // id -> { obj, geoKey, matKey, outline }
    this.data = null;
    this.library = { images: {} };
    this.envKey = null;
    this.sceneRadius = 1;
    this.composer = null;
    this.background = null;

    this.outlineMaterial = makeOutlineMaterial();

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.ShadowMaterial({ opacity: 0.32 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.userData.isGround = true;
    this.scene.add(this.ground);

    if (interactive) {
      this.grid = new THREE.GridHelper(20, 40, 0x6b7280, 0x3a3f48);
      this.grid.material.transparent = true;
      this.grid.material.opacity = 0.35;
      this.grid.position.y = 0.001;
      this.helpers.add(this.grid);
    }
  }

  setLibrary(library) {
    this.library = library;
  }

  get env() {
    return this.data?.environment ?? {};
  }

  get style() {
    return this.env.style ?? 'realistic';
  }

  get styleOptions() {
    return { ...DEFAULT_STYLE_OPTIONS, ...this.env.styleOptions };
  }

  get effects() {
    const fx = { ...DEFAULT_EFFECTS, ...this.env.effects };
    // Outlines confuse the corner-shadow effect, so toon style draws without it.
    if (this.style === 'toon') fx.ao = false;
    return fx;
  }

  // ---- scene sync -----------------------------------------------------------

  update(data) {
    this.data = data;
    const style = this.style;
    const styleKey = style + JSON.stringify(this.styleOptions);
    const seen = new Set();
    for (const id of data.order) {
      const o = data.objects[id];
      if (!o) continue;
      seen.add(id);
      let node = this.nodes.get(id);
      const isGroup = o.type === 'group';
      if (!node || (node.obj.isGroup !== isGroup)) {
        if (node) node.obj.removeFromParent();
        node = { obj: isGroup ? new THREE.Group() : new THREE.Mesh(), geoKey: null, matKey: null, outline: null };
        node.obj.userData.forgeId = id;
        this.nodes.set(id, node);
      }
      const obj = node.obj;
      obj.name = o.name;
      if (!isGroup) {
        const m = o.material;
        const surface = hasSurface(o);
        const geoOpts = {
          lowpoly: style === 'lowpoly',
          uvScale: surface ? (m.pattern?.scale ?? 1) : 0,
          objectScale: o.scale,
          edgeWear: o.type === 'box' && m.wear > 0 ? m.wear : 0,
        };
        const geoKey = JSON.stringify([o.type, o.params, geoOpts.lowpoly, geoOpts.uvScale, geoOpts.uvScale ? o.scale : 0, geoOpts.edgeWear]);
        if (geoKey !== node.geoKey) {
          obj.geometry?.dispose();
          obj.geometry = buildGeometry(o.type, o.params, geoOpts);
          node.geoKey = geoKey;
        }
        const matKey = JSON.stringify(m) + o.type + styleKey + (m.texture ? this.library.images[m.texture]?.file : '');
        if (matKey !== node.matKey) {
          obj.material?.dispose?.();
          obj.material = this.buildMaterial(o, !!obj.geometry.attributes.color);
          node.matKey = matKey;
        }
        obj.castShadow = true;
        obj.receiveShadow = true;
        this.syncOutline(node, o);
      }
      if (!node.locked) {
        obj.position.fromArray(o.position);
        obj.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
        obj.scale.fromArray(o.scale);
      }
      obj.visible = o.visible !== false;
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.obj.removeFromParent();
        node.obj.geometry?.dispose();
        this.nodes.delete(id);
      }
    }
    // parenting after all nodes exist
    for (const id of data.order) {
      const o = data.objects[id];
      const node = this.nodes.get(id);
      const parent = (o.parent && this.nodes.get(o.parent)?.obj) || this.content;
      if (node.obj.parent !== parent) parent.add(node.obj);
    }
    this.applyEnvironment(data.environment);
  }

  // Dark "shell" around each object for the toon style.
  syncOutline(node, o) {
    const want = this.style === 'toon' && this.styleOptions.outlineWidth > 0 && o.type !== 'image' && o.type !== 'plane';
    if (!want) {
      if (node.outline) { node.outline.removeFromParent(); node.outline = null; }
      return;
    }
    if (!node.outline) {
      node.outline = new THREE.Mesh(node.obj.geometry, this.outlineMaterial);
      node.outline.userData.isOutline = true;
      node.outline.raycast = () => {};
      node.obj.add(node.outline);
    }
    node.outline.geometry = node.obj.geometry;
  }

  buildMaterial(o, vertexColors) {
    const m = o.material;
    const style = this.style;
    const side = m.doubleSided ? THREE.DoubleSide : THREE.FrontSide;

    if (style === 'clay') {
      return new THREE.MeshStandardMaterial({ color: 0xd2cdc6, roughness: 0.78, metalness: 0, side });
    }

    const surface = hasSurface(o) ? this.patternTextures(m) : null;
    const absolute = surface && PATTERNS[m.pattern?.type]?.kind === 'absolute';
    let map = surface?.map ?? null;
    if (m.texture) {
      const asset = this.library.images[m.texture];
      if (asset) map = this.loadTexture(asset, m.textureRepeat ?? [1, 1]);
    }

    let mat;
    if (style === 'toon') {
      mat = new THREE.MeshToonMaterial({
        color: new THREE.Color(m.color),
        gradientMap: this.gradientMap(this.styleOptions.toonSteps),
        emissive: new THREE.Color(m.emissive ?? '#000000'),
        emissiveIntensity: m.emissiveIntensity ?? 1,
        side,
      });
      if (map) mat.map = map;
    } else {
      mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(m.color),
        metalness: absolute ? 1 : m.metalness,
        roughness: absolute ? 1 : m.roughness,
        emissive: new THREE.Color(m.emissive ?? '#000000'),
        emissiveIntensity: m.emissiveIntensity ?? 1,
        transmission: m.transmission ?? 0,
        ior: m.ior ?? 1.5,
        thickness: m.thickness ?? 0,
        clearcoat: m.clearcoat ?? 0,
        clearcoatRoughness: 0.15,
        flatShading: !!m.flatShading || style === 'lowpoly',
        side,
      });
      if (map) mat.map = map;
      if (surface) {
        mat.roughnessMap = surface.orm;
        mat.metalnessMap = surface.orm;
        mat.normalMap = surface.normal;
      }
    }
    if (vertexColors) mat.vertexColors = true;
    if (m.opacity < 1) {
      mat.transparent = true;
      mat.opacity = m.opacity;
    }
    if (o.type === 'image' && map) mat.alphaTest = 0.5;
    return mat;
  }

  patternTextures(m) {
    const p = m.pattern ?? { type: 'solid', seed: 1 };
    const absolute = PATTERNS[p.type]?.kind === 'absolute';
    const spec = {
      type: p.type, seed: p.seed ?? 1, variation: p.variation ?? 0.5, bump: p.bump ?? 1, angle: p.angle ?? 0,
      colors: absolute ? p.colors : null, wear: Math.round((m.wear ?? 0) * 20) / 20,
    };
    const key = JSON.stringify(spec);
    if (this.patternCache.has(key)) return this.patternCache.get(key);
    const out = generatePattern(spec, 512);
    const tex = (canvas, srgb) => {
      const t = new THREE.CanvasTexture(canvas);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const result = { map: tex(out.color, true), orm: tex(out.orm, false), normal: tex(out.normal, false) };
    this.patternCache.set(key, result);
    return result;
  }

  gradientMap(steps) {
    if (this.gradientCache.has(steps)) return this.gradientCache.get(steps);
    const data = new Uint8Array(steps * 4);
    for (let i = 0; i < steps; i++) {
      const v = Math.round((0.25 + 0.75 * (i / (steps - 1))) * 255);
      data.set([v, v, v, 255], i * 4);
    }
    const tex = new THREE.DataTexture(data, steps, 1);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.gradientCache.set(steps, tex);
    return tex;
  }

  loadTexture(asset, repeat) {
    const key = `${asset.file}|${repeat.join(',')}`;
    if (this.textureCache.has(key)) return this.textureCache.get(key);
    const tex = new THREE.Texture();
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { tex.image = img; tex.needsUpdate = true; resolve(); };
      img.onerror = () => { console.error(`texture failed: ${asset.file}`); resolve(); };
      img.src = `/library/images/${asset.file}`;
    });
    this.pendingLoads.add(p);
    p.finally(() => this.pendingLoads.delete(p));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.fromArray(repeat);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.textureCache.set(key, tex);
    return tex;
  }

  async whenReady() {
    while (this.pendingLoads.size) await Promise.all([...this.pendingLoads]);
  }

  // ---- lighting -------------------------------------------------------------

  applyEnvironment(env) {
    const preset = LIGHTING_PRESETS[env.lighting] ?? LIGHTING_PRESETS.studio;
    this.scene.environment = this.envTexture(env.lighting, preset);
    this.scene.environmentIntensity = preset.envIntensity;
    this.renderer.toneMappingExposure = (env.exposure ?? 1) * preset.exposure;
    this.setGround(env.ground !== false, env.groundColor);

    const key = env.lighting;
    if (key !== this.envKey) {
      this.envKey = key;
      this.lights.clear();
      for (const l of preset.lights) {
        const light = new THREE.DirectionalLight(l.color, l.intensity);
        light.position.fromArray(l.position);
        if (l.shadow) {
          light.castShadow = true;
          light.shadow.mapSize.set(2048, 2048);
          light.shadow.bias = -0.0002;
          light.shadow.normalBias = 0.02;
          light.shadow.radius = 4;
        }
        this.lights.add(light, light.target);
      }
    }
    this.fitShadows();
    this.setBackground(env.background ?? preset.background);
  }

  // Remember the wanted background; the actual colour is set right before drawing
  // because it depends on whether picture effects are used.
  setBackground(bg) {
    this.background = bg;
  }

  prepareBackground(useEffects) {
    const bg = this.background;
    if (!bg || bg === 'transparent') {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.scene.background = useEffects ? compensateBackground(bg, this.renderer.toneMappingExposure) : new THREE.Color(bg);
    }
  }

  setGround(show, color) {
    this.ground.visible = show;
    const wantShadowOnly = !color;
    if (wantShadowOnly && !this.ground.material.isShadowMaterial) {
      this.ground.material.dispose();
      this.ground.material = new THREE.ShadowMaterial({ opacity: 0.32 });
    } else if (!wantShadowOnly) {
      if (this.ground.material.isShadowMaterial) {
        this.ground.material.dispose();
        this.ground.material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
      }
      this.ground.material.color.set(color);
    }
  }

  // Size each shadow camera to the content so shadows stay sharp.
  fitShadows() {
    const box = contentBox(this.content);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    this.sceneRadius = box.isEmpty() ? 1 : Math.max(0.2, box.getBoundingSphere(new THREE.Sphere()).radius);
    const radius = Math.max(1, this.sceneRadius * 1.6);
    for (const light of this.lights.children) {
      if (!light.isDirectionalLight) continue;
      const dir = light.position.clone().normalize();
      light.target.position.copy(center);
      light.position.copy(center).addScaledVector(dir, radius * 3);
      if (light.castShadow) {
        const cam = light.shadow.camera;
        cam.left = cam.bottom = -radius;
        cam.right = cam.top = radius;
        cam.near = 0.1;
        cam.far = radius * 6;
        cam.updateProjectionMatrix();
      }
    }
    const o = this.styleOptions;
    this.outlineMaterial.userData.width.value = this.sceneRadius * 0.006 * o.outlineWidth;
    this.outlineMaterial.color.set(o.outlineColor);
  }

  envTexture(name, preset) {
    if (this.envCache.has(name)) return this.envCache.get(name);
    let envScene;
    if (preset.env === 'sky') envScene = skyScene(preset.sky, preset.lights[0]?.position, preset.lights[0]?.color);
    else envScene = new RoomEnvironment();
    const tex = this.pmrem.fromScene(envScene, 0.04).texture;
    this.envCache.set(name, tex);
    return tex;
  }

  // ---- drawing ----------------------------------------------------------------

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  usesEffects(fx = this.effects, transparent = false) {
    return fx.ao || (fx.bloom && !transparent);
  }

  draw(camera = this.camera) {
    const fx = this.effects;
    const use = this.usesEffects(fx);
    this.prepareBackground(use);
    if (!use) {
      disposeComposer(this.composer);
      this.composer = null;
      this.renderer.render(this.scene, camera);
      return;
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    const key = JSON.stringify([fx.ao, fx.bloom, size.x, size.y, this.renderer.getPixelRatio(), camera.uuid]);
    if (this.composer?.key !== key) {
      disposeComposer(this.composer);
      this.composer = createComposer(this.renderer, this.scene, camera, size.x, size.y, fx, this.sceneRadius);
      this.composer.key = key;
    }
    tuneComposer(this.composer, fx, this.sceneRadius);
    this.composer.composer.render();
  }

  frameCamera(camera, view, targetId) {
    const target = targetId ? this.nodes.get(targetId)?.obj : this.content;
    const box = contentBox(target ?? this.content);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3().fromArray(VIEW_DIRS[view] ?? VIEW_DIRS.iso).normalize();
    const fitH = sphere.radius / Math.sin((camera.fov * DEG) / 2);
    const fitW = fitH / Math.min(1, camera.aspect);
    const dist = Math.max(fitH, fitW) * 1.05;
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    return sphere.center;
  }

  // Render a picture. Supersamples for clean edges, returns base64 PNG.
  async renderImage({ view = 'iso', width = 768, height = 768, target, background, ground }) {
    await this.whenReady();
    const env = this.data.environment;
    const ss = width * height <= 1024 * 1024 ? 2 : 1;
    const cam = new THREE.PerspectiveCamera(35, width / height, 0.01, 500);
    if (view === 'camera') {
      cam.position.fromArray(this.data.camera.position);
      cam.lookAt(new THREE.Vector3().fromArray(this.data.camera.target));
    } else {
      this.frameCamera(cam, view, target);
    }

    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevRatio = this.renderer.getPixelRatio();
    const helpersVisible = this.helpers.visible;
    this.helpers.visible = false;
    if (background !== undefined) this.setBackground(background);
    if (ground !== undefined) this.ground.visible = ground;
    const transparent = this.background === 'transparent';

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width * ss, height * ss, false);
    const fx = { ...this.effects };
    if (transparent) fx.bloom = false; // glow cannot be stored in see-through pixels
    const use = this.usesEffects(fx, transparent);
    this.prepareBackground(use);
    if (use) {
      const c = createComposer(this.renderer, this.scene, cam, width * ss, height * ss, fx, this.sceneRadius);
      c.composer.render();
      disposeComposer(c);
    } else {
      this.renderer.render(this.scene, cam);
    }

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas, 0, 0, width, height);

    this.helpers.visible = helpersVisible;
    this.setBackground(env.background ?? LIGHTING_PRESETS[env.lighting]?.background);
    this.ground.visible = env.ground !== false;
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);

    return { png: out.toDataURL('image/png').split(',')[1], width, height };
  }

  async exportGlb({ target }) {
    await this.whenReady();
    const root = target ? this.nodes.get(target)?.obj : this.content;
    const outlines = [];
    root.traverse((o) => { if (o.userData.isOutline && o.visible) { o.visible = false; outlines.push(o); } });
    try {
      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
      return { glb: bufferToBase64(result) };
    } finally {
      for (const o of outlines) o.visible = true;
    }
  }

  objectById(id) {
    return this.nodes.get(id)?.obj ?? null;
  }
}

// A material needs generated textures when it has a pattern or shows wear.
function hasSurface(o) {
  return o.type !== 'image' && !!o.material && (!!o.material.pattern || o.material.wear > 0);
}

// Bounding box of the real objects only (ignores outline shells).
function contentBox(root) {
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverseVisible((o) => {
    if (!o.isMesh || o.userData.isOutline) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

export function buildGeometry(type, p, { lowpoly = false, uvScale = 0, objectScale = [1, 1, 1], edgeWear = 0 } = {}) {
  const seg = (n, min) => (lowpoly ? Math.min(n, min) : n);
  let g;
  switch (type) {
    case 'box': {
      const r = Math.min(p.bevel, Math.min(p.width, p.height, p.depth) / 2 - 1e-4);
      g = r > 0
        ? new RoundedBoxGeometry(p.width, p.height, p.depth, lowpoly ? 1 : Math.max(1, Math.round(p.bevelSegments)), r)
        : new THREE.BoxGeometry(p.width, p.height, p.depth);
      break;
    }
    case 'sphere': g = new THREE.SphereGeometry(p.radius, seg(p.segments, 12), seg(Math.max(4, Math.round(p.segments / 2)), 8)); break;
    case 'cylinder': g = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, seg(p.segments, 10)); break;
    case 'cone': g = new THREE.ConeGeometry(p.radius, p.height, seg(p.segments, 10)); break;
    case 'torus': g = new THREE.TorusGeometry(p.radius, p.tube, seg(Math.max(8, Math.round(p.segments / 2)), 6), seg(p.segments * 2, 14)); break;
    case 'capsule': g = new THREE.CapsuleGeometry(p.radius, p.length, lowpoly ? 2 : 8, seg(p.segments, 8)); break;
    case 'plane': case 'image': g = new THREE.PlaneGeometry(p.width, p.height); break;
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  if (uvScale) metricUVs(g, type, p, uvScale, objectScale);
  if (edgeWear) edgeWearColors(g, edgeWear);
  return g;
}

// Give textures a real-world size (metres per tile) so patterns are never stretched.
function metricUVs(g, type, p, scale, s) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const avg = (s[0] + s[1] + s[2]) / 3;
  const k = 1 / scale;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * s[0], y = pos.getY(i) * s[1], z = pos.getZ(i) * s[2];
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    switch (type) {
      case 'box':
        if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = z; } else { u = x; v = y; }
        break;
      case 'plane': u = x; v = y; break;
      case 'cylinder': case 'cone': {
        const r = type === 'cone' ? p.radius / 2 : (p.radiusTop + p.radiusBottom) / 2;
        if (ny > 0.9) { u = x; v = z; } else { u = uv.getX(i) * Math.PI * 2 * r * avg; v = y; }
        break;
      }
      case 'sphere': u = uv.getX(i) * Math.PI * 2 * p.radius * avg; v = uv.getY(i) * Math.PI * p.radius * avg; break;
      case 'torus': u = uv.getX(i) * Math.PI * 2 * p.radius * avg; v = uv.getY(i) * Math.PI * 2 * p.tube * avg; break;
      case 'capsule': u = uv.getX(i) * Math.PI * 2 * p.radius * avg; v = uv.getY(i) * (p.length + Math.PI * p.radius) * avg; break;
      default: u = uv.getX(i); v = uv.getY(i);
    }
    uv.setXY(i, u * k, v * k);
  }
  uv.needsUpdate = true;
}

// Darken the rounded edges of a box a little: they are where wear shows first.
function edgeWearColors(g, wear) {
  const nor = g.attributes.normal;
  const colors = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) {
    const e = 1 - Math.max(Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i)));
    const t = Math.min(1, Math.max(0, (e - 0.03) / 0.17));
    const c = 1 - wear * 0.5 * t * t * (3 - 2 * t);
    colors.set([c, c * 0.97, c * 0.94], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function makeOutlineMaterial() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x1b1c20, side: THREE.BackSide });
  mat.userData.width = { value: 0.01 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = mat.userData.width;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 outlineScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        transformed += normalize(normal) * outlineWidth / max(outlineScale, vec3(1e-4));`);
  };
  return mat;
}

// A gradient sky with a bright sun disc, used to light "sky" presets.
function skyScene([top, horizon, bottom], sunPos = [5, 8, 3], sunColor = '#ffffff') {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.4)); gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(sunColor).multiplyScalar(20) }));
  sun.position.fromArray(sunPos).normalize().multiplyScalar(40);
  scene.add(sun);
  return scene;
}

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
