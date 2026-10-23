import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { LIGHTING_PRESETS, PATTERNS, DEFAULT_EFFECTS, DEFAULT_STYLE_OPTIONS } from '/shared/presets.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import { createComposer, tuneComposer, disposeComposer, compensateBackground } from './effects.js';
import { generatePattern } from './patterns.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { latheGeometry, extrudeGeometry, textGeometry, rockGeometry, cutoutGeometry, traceImage } from './shapes.js';
import { hardenAlpha, quantize, pixelOutline, softOutline, seloutOutline, cleanupPixels } from './pixelart.js';
import { sampleObject } from '/shared/animations.js';

const CSG_OPS = { subtract: SUBTRACTION, union: ADDITION, intersect: INTERSECTION };

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
    this.fonts = new Map();
    this.outlines = new Map();
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
      // groups and imported models are containers; everything else is one mesh
      const isGroup = o.type === 'group' || o.type === 'model';
      if (!node || (node.obj.isGroup !== isGroup)) {
        if (node) node.obj.removeFromParent();
        node = { obj: isGroup ? new THREE.Group() : new THREE.Mesh(), geoKey: null, matKey: null, outline: null };
        node.obj.userData.forgeId = id;
        this.nodes.set(id, node);
      }
      const obj = node.obj;
      obj.name = o.name;
      if (o.type === 'model') this.syncModel(node, o);
      if (!isGroup) {
        const m = o.material;
        const surface = hasSurface(o);
        const geoOpts = {
          lowpoly: style === 'lowpoly',
          uvScale: surface ? (m.pattern?.scale ?? 1) : 0,
          objectScale: o.scale,
          edgeWear: o.type === 'box' && m.wear > 0 ? m.wear : 0,
        };
        const resource = this.resourceFor(o);
        const geoKey = JSON.stringify([o.type, o.params, geoOpts.lowpoly, geoOpts.uvScale, geoOpts.uvScale ? o.scale : 0, geoOpts.edgeWear, !!resource]);
        if (geoKey !== node.geoKey) {
          if (obj.geometry !== node.base) obj.geometry?.dispose();
          node.base?.dispose();
          node.base = buildGeometry(o.type, o.params, { ...geoOpts, resource });
          obj.geometry = node.base;
          node.geoKey = geoKey;
          node.csgKey = null;
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
    this.applyBooleans(data);
    this.applyEnvironment(data.environment);
  }

  // Imported .glb model: loaded once, then a copy is scaled to the wanted height and
  // stood on the ground at the object's origin.
  syncModel(node, o) {
    const asset = this.library.models?.[o.params.assetId];
    if (!asset) return;
    const gltf = this.models?.get(asset.file);
    const key = `${asset.file}|${o.params.size}|${!!gltf}`;
    if (node.modelKey === key) return;
    if (!gltf) {
      this.models ??= new Map();
      this.track(`model:${asset.file}`, new GLTFLoader().loadAsync(`/library/models/${asset.file}`).then((g) => this.models.set(asset.file, g)));
      return;
    }
    node.modelKey = key;
    for (const child of [...node.obj.children]) if (child.userData.isModelContent) child.removeFromParent();
    const copy = gltf.scene.clone(true);
    copy.userData.isModelContent = true;
    copy.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.userData.forgeId = o.id; } });
    copy.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy);
    const h = box.max.y - box.min.y;
    const s = o.params.size > 0 && h > 0 ? o.params.size / h : 1;
    copy.scale.multiplyScalar(s);
    const c = box.getCenter(new THREE.Vector3());
    copy.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    node.obj.add(copy);
  }

  // Fonts (text) and traced outlines (cut-outs) load in the background; when ready the
  // scene is rebuilt. Returns null while still loading.
  resourceFor(o) {
    if (o.type === 'text') {
      const name = o.params.font;
      if (this.fonts.has(name)) return this.fonts.get(name);
      this.track(`font:${name}`, new FontLoader().loadAsync(`/vendor/three/examples/fonts/${name}.typeface.json`).then((f) => this.fonts.set(name, f)));
      return null;
    }
    if (o.type === 'cutout') {
      const asset = this.library.images[o.params.assetId];
      if (!asset) return null;
      const key = `${asset.file}|${o.params.threshold}`;
      if (this.outlines.has(key)) return this.outlines.get(key);
      this.track(`outline:${key}`, loadImage(`/library/images/${asset.file}`).then((img) => this.outlines.set(key, traceImage(img, o.params.threshold))));
      return null;
    }
    return undefined;
  }

  track(key, promise) {
    this.loading ??= new Set();
    if (this.loading.has(key)) return;
    this.loading.add(key);
    const p = promise
      .catch((err) => console.error(`load failed (${key}): ${err.message}`))
      .finally(() => { this.loading.delete(key); if (this.data) this.update(this.data); });
    this.pendingLoads.add(p);
    p.finally(() => this.pendingLoads.delete(p));
  }

  // Cut and combine: objects listed in `booleans` are subtracted from / added to / intersected
  // with this object. The cutter objects themselves stay in the scene, hidden.
  applyBooleans(data) {
    this.content.updateMatrixWorld(true);
    for (const id of data.order) {
      const o = data.objects[id];
      const node = this.nodes.get(id);
      if (!node || o.type === 'group') continue;
      if (!o.booleans?.length) {
        if (node.csgKey) { node.obj.geometry.dispose(); node.obj.geometry = node.base; node.csgKey = null; this.syncOutline(node, o); }
        continue;
      }
      const inv = node.obj.matrixWorld.clone().invert();
      const parts = o.booleans.map((b) => {
        const cn = this.nodes.get(b.id);
        if (!cn?.base || !CSG_OPS[b.op]) return null;
        return { op: CSG_OPS[b.op], geo: cn.base, rel: inv.clone().multiply(cn.obj.matrixWorld), key: cn.geoKey };
      }).filter(Boolean);
      const key = JSON.stringify([node.geoKey, parts.map((p) => [p.op, p.key, p.rel.elements.map((e) => Math.round(e * 1e4))])]);
      if (key === node.csgKey) continue;
      if (node.csgKey) node.obj.geometry.dispose();
      try {
        node.obj.geometry = csg(node.base, parts);
      } catch (err) {
        console.error(`cut/combine failed for ${id}: ${err.message}`);
        node.obj.geometry = node.base;
      }
      node.csgKey = key;
      this.syncOutline(node, o);
    }
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
      t.userData.mimeType = 'image/jpeg'; // much smaller GLB files; noise textures hide JPEG artefacts
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

  frameCamera(camera, view, targetId, padding = 0) {
    const target = targetId ? this.nodes.get(targetId)?.obj : this.content;
    const box = contentBox(target ?? this.content);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const center = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3().fromArray(VIEW_DIRS[view] ?? VIEW_DIRS.iso).normalize();
    // Find the distance at which every corner of the box fits inside the picture.
    camera.position.copy(center).add(dir);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const toCam = camera.matrixWorldInverse.clone().setPosition(0, 0, 0);
    const tanV = Math.tan((camera.fov * DEG) / 2), tanH = tanV * camera.aspect;
    let dist = 0;
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      c.sub(center).applyMatrix4(toCam);
      dist = Math.max(dist, c.z + Math.abs(c.x) / tanH, c.z + Math.abs(c.y) / tanV);
    }
    dist = Math.max(dist * (1.08 + padding * 2), 0.05);
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    return center;
  }

  // Render a picture. Supersamples for clean edges, returns base64 PNG.
  async renderImage({ view = 'iso', width = 768, height = 768, target, background, ground, isolate = false, padding = 0, outline = null }) {
    await this.whenReady();
    this.resetPose();
    const env = this.data.environment;
    const restoreIsolation = isolate && target ? this.isolate(target) : null;
    const ss = width * height <= 1024 * 1024 ? 2 : 1;
    const cam = new THREE.PerspectiveCamera(35, width / height, 0.01, 500);
    if (view === 'camera') {
      cam.position.fromArray(this.data.camera.position);
      cam.lookAt(new THREE.Vector3().fromArray(this.data.camera.target));
    } else {
      this.frameCamera(cam, view, target, padding);
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
    if (outline && transparent) {
      const img = ctx.getImageData(0, 0, width, height);
      softOutline(img, outline.color, outline.width);
      ctx.putImageData(img, 0, 0);
    }

    this.helpers.visible = helpersVisible;
    this.setBackground(env.background ?? LIGHTING_PRESETS[env.lighting]?.background);
    this.ground.visible = env.ground !== false;
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    restoreIsolation?.();

    return { png: out.toDataURL('image/png').split(',')[1], width, height };
  }

  // Hide everything except one object (with its parents and children). Returns an undo function.
  isolate(targetId) {
    const target = this.nodes.get(targetId)?.obj;
    if (!target) return () => {};
    const keep = new Set();
    target.traverse((o) => keep.add(o));
    for (let p = target.parent; p; p = p.parent) keep.add(p);
    const hidden = [];
    for (const { obj } of this.nodes.values()) {
      if (!keep.has(obj) && obj.visible) { obj.visible = false; hidden.push(obj); }
    }
    this.fitShadows();
    return () => { for (const o of hidden) o.visible = true; this.fitShadows(); };
  }

  // ---- animation --------------------------------------------------------------

  // Put every animated object in its pose at time t (0..1) of an animation.
  pose(name, t) {
    const anim = this.data?.animations?.[name];
    this.resetPose();
    if (!anim) return;
    this.posed = new Set();
    for (const id of new Set(anim.tracks.map((tr) => tr.target))) {
      const node = this.nodes.get(id);
      const o = this.data.objects[id];
      const off = node && o && sampleObject(anim, id, t);
      if (!off || node.locked) continue;
      node.obj.position.set(...o.position.map((v, i) => v + off.position[i]));
      node.obj.rotation.set(...o.rotation.map((v, i) => (v + off.rotation[i]) * DEG));
      node.obj.scale.set(...o.scale.map((v, i) => v * off.scale[i]));
      this.posed.add(id);
    }
  }

  resetPose() {
    if (!this.posed) return;
    for (const id of this.posed) {
      const node = this.nodes.get(id), o = this.data.objects[id];
      if (!node || !o) continue;
      node.obj.position.fromArray(o.position);
      node.obj.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
      node.obj.scale.fromArray(o.scale);
    }
    this.posed = null;
  }

  // ---- sprites ------------------------------------------------------------------

  // Sprite sheet: rows = (animation ×) direction, columns = frames. Besides the colour sheet
  // it can make a normal map (for 2D lights) and a glow map from exactly the same frames.
  async renderSprites({
    target, directions = 8, frameSize = 64, animations = [], frames = 1, elevation = 30, azimuthOffset = 0,
    pixelArt = true, colors = 24, palette, dither = 0, outline = '#16171b', outlineStyle = 'solid', cleanup = true,
    pixelsPerMetre = null, groundShadow = false, maps = [],
  }) {
    await this.whenReady();
    this.resetPose();
    const env = this.data.environment;
    const anims = animations.length ? animations.map((name) => ({ name, def: this.data.animations?.[name] })) : [{ name: null, def: null }];
    const frameCount = anims[0].def ? frames : 1;
    const restoreIsolation = target ? this.isolate(target) : null;
    const root = (target && this.nodes.get(target)?.obj) || this.content;

    // one fixed frame for every direction, animation and frame, so the sprite never jumps or resizes
    const box = new THREE.Box3();
    for (const a of anims) {
      for (let f = 0; f < frameCount; f++) {
        if (a.def) this.pose(a.name, f / frameCount);
        box.union(contentBox(root));
      }
    }
    this.resetPose();
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const center = box.getCenter(new THREE.Vector3());
    // fixed pixels per metre keeps different assets at the same scale; otherwise fit the frame
    const radius = pixelsPerMetre ? frameSize / pixelsPerMetre / 2 : box.getBoundingSphere(new THREE.Sphere()).radius * (1 + 2.5 / frameSize);
    const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, radius * 0.05, radius * 40);

    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevRatio = this.renderer.getPixelRatio();
    const helpersVisible = this.helpers.visible;
    this.helpers.visible = false;
    this.setBackground('transparent');
    this.prepareBackground(false);
    this.ground.visible = groundShadow;
    const res = pixelArt ? frameSize : frameSize * 2;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(res, res, false);

    const rows = [];
    for (const a of anims) for (let d = 0; d < directions; d++) rows.push({ anim: a, d });
    const makeSheet = () => {
      const c = document.createElement('canvas');
      c.width = frameCount * frameSize;
      c.height = rows.length * frameSize;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = !pixelArt;
      ctx.imageSmoothingQuality = 'high';
      return { c, ctx };
    };
    const passes = [{ kind: 'color', ...makeSheet() }];
    if (maps.includes('normal')) passes.push({ kind: 'normal', ...makeSheet() });
    const glowParts = maps.includes('emission') ? this.emissiveMeshes(root) : [];
    if (glowParts.length) passes.push({ kind: 'emission', ...makeSheet() });

    const el = elevation * DEG;
    const normalMat = new THREE.MeshNormalMaterial();
    rows.forEach(({ anim: a, d }, r) => {
      const az = (d / directions) * Math.PI * 2 + azimuthOffset * DEG;
      cam.position.set(center.x + Math.sin(az) * Math.cos(el) * radius * 10, center.y + Math.sin(el) * radius * 10, center.z + Math.cos(az) * Math.cos(el) * radius * 10);
      cam.lookAt(center);
      for (let f = 0; f < frameCount; f++) {
        if (a.def) this.pose(a.name, f / frameCount);
        for (const p of passes) {
          if (p.kind === 'normal') { this.scene.overrideMaterial = normalMat; this.ground.visible = false; }
          if (p.kind === 'emission') this.swapToGlow(glowParts, true);
          this.renderer.render(this.scene, cam);
          p.ctx.drawImage(this.canvas, f * frameSize, r * frameSize, frameSize, frameSize);
          this.scene.overrideMaterial = null;
          this.ground.visible = groundShadow;
          if (p.kind === 'emission') this.swapToGlow(glowParts, false);
        }
      }
    });
    this.resetPose();
    normalMat.dispose();

    let usedPalette = null;
    const color = passes[0];
    const colorImg = color.ctx.getImageData(0, 0, color.c.width, color.c.height);
    if (pixelArt) {
      hardenAlpha(colorImg);
      usedPalette = quantize(colorImg, colors, palette, dither);
      if (cleanup) cleanupPixels(colorImg);
      if (outline && outlineStyle === 'selout') seloutOutline(colorImg, palette);
      else if (outline) pixelOutline(colorImg, outline);
      color.ctx.putImageData(colorImg, 0, 0);
    }
    // extra maps share the colour sheet's exact shape
    const out = {};
    for (const p of passes.slice(1)) {
      const img = p.ctx.getImageData(0, 0, p.c.width, p.c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const a = colorImg.data[i + 3];
        if (p.kind === 'normal' && (a === 0 || img.data[i + 3] === 0)) img.data.set([128, 128, 255], i);
        img.data[i + 3] = pixelArt ? (a ? 255 : 0) : a;
      }
      p.ctx.putImageData(img, 0, 0);
      out[p.kind] = p.c.toDataURL('image/png').split(',')[1];
    }

    this.helpers.visible = helpersVisible;
    this.setBackground(env.background ?? LIGHTING_PRESETS[env.lighting]?.background);
    this.ground.visible = env.ground !== false;
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    restoreIsolation?.();

    const names = { 1: ['down'], 4: ['down', 'left', 'up', 'right'], 8: ['down', 'down_left', 'left', 'up_left', 'up', 'up_right', 'right', 'down_right'] }[directions];
    const def = anims[0].def;
    return {
      png: color.c.toDataURL('image/png').split(',')[1],
      normal: out.normal ?? null,
      emission: out.emission ?? null,
      meta: {
        frameSize, rows: rows.length, columns: frameCount, directions: names,
        rowNames: rows.map(({ anim: a, d }) => (a.name ? `${a.name}_${names[d]}` : names[d])),
        animations: anims.map((a) => a.name).filter(Boolean),
        fps: def ? Math.round((frameCount / def.duration) * 100) / 100 : null,
        pixelsPerMetre: pixelsPerMetre ?? Math.round((frameSize / (2 * radius)) * 100) / 100,
        palette: usedPalette,
      },
    };
  }

  emissiveMeshes(root) {
    const list = [];
    root.traverseVisible((m) => {
      if (m.isMesh && !m.userData.isOutline && m.material?.emissive && m.material.emissiveIntensity > 0 && m.material.emissive.getHex() !== 0) list.push(m);
    });
    return list;
  }

  // For the glow map: everything black except glowing parts in their glow colour.
  swapToGlow(glowParts, on) {
    if (on) {
      this.glowSaved = [];
      this.content.traverse((m) => {
        if (!m.isMesh || m.userData.isOutline) return;
        this.glowSaved.push([m, m.material]);
        const glow = glowParts.includes(m);
        m.material = new THREE.MeshBasicMaterial({ color: glow ? m.material.emissive.clone().multiplyScalar(Math.min(1, m.material.emissiveIntensity / 2)) : 0x000000 });
      });
      this.ground.visible = false;
    } else {
      for (const [m, mat] of this.glowSaved ?? []) { m.material.dispose(); m.material = mat; }
      this.glowSaved = null;
    }
  }

  // ---- export -----------------------------------------------------------------

  async exportGlb({ target, collision = 'none', animations = true, atOrigin = false, name = 'asset' }) {
    await this.whenReady();
    this.resetPose();
    const root = target ? this.nodes.get(target)?.obj : this.content;
    const outlines = [];
    root.traverse((o) => { if (o.userData.isOutline && o.visible) { o.visible = false; outlines.push(o); } });
    const savedPos = root.position.clone();
    if (atOrigin && target) root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const col = collision !== 'none' ? collisionMesh(root, collision, name) : null;
    if (col) root.add(col);
    try {
      const clips = animations ? this.animationClips(root) : [];
      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(root, { binary: true, onlyVisible: true, animations: clips });
      return { glb: bufferToBase64(result) };
    } finally {
      if (col) { col.removeFromParent(); col.geometry.dispose(); }
      root.position.copy(savedPos);
      root.updateMatrixWorld(true);
      for (const o of outlines) o.visible = true;
    }
  }

  // Bake the scene's animations (that touch this export) into glTF animation clips at 30 fps.
  animationClips(root) {
    const inside = new Set();
    root.traverse((o) => inside.add(o));
    const clips = [];
    for (const [name, anim] of Object.entries(this.data.animations ?? {})) {
      const fps = 30, n = Math.max(2, Math.round(anim.duration * fps));
      const times = Array.from({ length: n + 1 }, (_, i) => (i / n) * anim.duration);
      const tracks = [];
      for (const id of new Set(anim.tracks.map((tr) => tr.target))) {
        const obj = this.nodes.get(id)?.obj;
        if (!obj || !inside.has(obj)) continue;
        const base = { p: obj.position.clone(), r: obj.rotation.clone(), s: obj.scale.clone() };
        const pos = [], quat = [], scl = [];
        const q = new THREE.Quaternion(), e = new THREE.Euler();
        for (let i = 0; i <= n; i++) {
          const off = sampleObject(anim, id, (i / n) % 1);
          const o = off ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
          pos.push(base.p.x + o.position[0], base.p.y + o.position[1], base.p.z + o.position[2]);
          e.set(base.r.x + o.rotation[0] * DEG, base.r.y + o.rotation[1] * DEG, base.r.z + o.rotation[2] * DEG);
          q.setFromEuler(e);
          quat.push(q.x, q.y, q.z, q.w);
          scl.push(base.s.x * o.scale[0], base.s.y * o.scale[1], base.s.z * o.scale[2]);
        }
        tracks.push(
          new THREE.VectorKeyframeTrack(`${obj.uuid}.position`, times, pos),
          new THREE.QuaternionKeyframeTrack(`${obj.uuid}.quaternion`, times, quat),
          new THREE.VectorKeyframeTrack(`${obj.uuid}.scale`, times, scl),
        );
      }
      if (tracks.length) clips.push(new THREE.AnimationClip(name, anim.duration, tracks));
    }
    return clips;
  }

  objectById(id) {
    return this.nodes.get(id)?.obj ?? null;
  }
}

// Collision shape for Godot. Godot's importer turns nodes whose name ends in "-colonly"
// (exact triangles) or "-convcolonly" (convex hull) into collision shapes without a visible mesh.
function collisionMesh(root, kind, name) {
  const inv = root.matrixWorld.clone().invert();
  const points = [];
  const v = new THREE.Vector3();
  const tris = [];
  root.traverseVisible((o) => {
    if (!o.isMesh || o.userData.isOutline || !o.geometry.attributes.position) return;
    const m = inv.clone().multiply(o.matrixWorld);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      points.push(v.clone());
      if (kind === 'mesh') tris.push(v.x, v.y, v.z);
    }
  });
  if (!points.length) return null;
  let geo;
  if (kind === 'box') {
    const box = new THREE.Box3().setFromPoints(points);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    geo = new THREE.BoxGeometry(Math.max(size.x, 0.001), Math.max(size.y, 0.001), Math.max(size.z, 0.001)).translate(c.x, c.y, c.z);
  } else if (kind === 'convex') {
    // thin out very dense meshes; the hull only needs the outer points
    const step = Math.max(1, Math.floor(points.length / 4000));
    geo = new ConvexGeometry(points.filter((_, i) => i % step === 0));
  } else {
    geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff00ff }));
  mesh.name = `${name}${kind === 'mesh' ? '-colonly' : '-convcolonly'}`;
  return mesh;
}

// A material needs generated textures when it has a pattern or shows wear.
function hasSurface(o) {
  return o.type !== 'image' && o.type !== 'cutout' && !!o.material && (!!o.material.pattern || o.material.wear > 0);
}

function csg(base, parts) {
  // A fresh evaluator each time: it keeps attribute settings from earlier runs.
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  const withColor = !!base.attributes.color;
  evaluator.attributes = withColor ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
  const prep = (g) => {
    const c = g.clone();
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    if (withColor && !c.attributes.color) c.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 3).fill(1), 3));
    if (!withColor) c.deleteAttribute('color');
    for (const name of Object.keys(c.attributes)) if (!evaluator.attributes.includes(name)) c.deleteAttribute(name);
    return c;
  };
  let a = new Brush(prep(base));
  a.updateMatrixWorld();
  for (const p of parts) {
    const b = new Brush(prep(p.geo));
    p.rel.decompose(b.position, b.quaternion, b.scale);
    b.updateMatrixWorld();
    a = evaluator.evaluate(a, b, p.op);
  }
  return a.geometry;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${src}`));
    img.src = src;
  });
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

export function buildGeometry(type, p, { lowpoly = false, uvScale = 0, objectScale = [1, 1, 1], edgeWear = 0, resource = null } = {}) {
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
    case 'cylinder': {
      const theta = Math.min(360, Math.max(1, p.thetaLength ?? 360));
      g = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, seg(p.segments, 10), 1, false, Math.PI / 2 - (theta * DEG) / 2, theta * DEG);
      break;
    }
    case 'lathe': g = latheGeometry(p, lowpoly); break;
    case 'extrude': g = extrudeGeometry(p); break;
    case 'text': g = textGeometry(p, resource); break;
    case 'rock': g = rockGeometry({ ...p, detail: lowpoly ? Math.min(p.detail, 1) : p.detail, sharpness: lowpoly ? 1 : p.sharpness }); break;
    case 'cutout': g = resource ? cutoutGeometry(p, resource) : new THREE.PlaneGeometry(p.width, p.height); break;
    case 'cone': g = new THREE.ConeGeometry(p.radius, p.height, seg(p.segments, 10)); break;
    case 'torus': g = new THREE.TorusGeometry(p.radius, p.tube, seg(Math.max(8, Math.round(p.segments / 2)), 6), seg(p.segments * 2, 14)); break;
    case 'capsule': g = new THREE.CapsuleGeometry(p.radius, p.length, lowpoly ? 2 : 8, seg(p.segments, 8)); break;
    case 'plane': case 'image': g = new THREE.PlaneGeometry(p.width, p.height); break;
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  if (uvScale) metricUVs(g, type, p, uvScale, objectScale);
  else if (type === 'rock') metricUVs(g, type, p, 1, objectScale); // rocks have no UVs of their own
  if (edgeWear) edgeWearColors(g, edgeWear);
  return g;
}

// Give textures a real-world size (metres per tile) so patterns are never stretched.
function metricUVs(g, type, p, scale, s) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  if (!pos?.count || !nor || !uv) return;
  const avg = (s[0] + s[1] + s[2]) / 3;
  const k = 1 / scale;
  const latheR = type === 'lathe' ? Math.max(...p.points.map((pt) => pt[0])) : 0;
  const latheLen = type === 'lathe' ? p.points.reduce((a, pt, i) => (i ? a + Math.hypot(pt[0] - p.points[i - 1][0], pt[1] - p.points[i - 1][1]) : 0), 0) : 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * s[0], y = pos.getY(i) * s[1], z = pos.getZ(i) * s[2];
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    switch (type) {
      case 'box': case 'rock':
        if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = z; } else { u = x; v = y; }
        break;
      case 'lathe': u = uv.getX(i) * Math.PI * 2 * latheR * avg; v = uv.getY(i) * latheLen * avg; break;
      case 'extrude': case 'text': u = uv.getX(i) * avg; v = uv.getY(i) * avg; break;
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
