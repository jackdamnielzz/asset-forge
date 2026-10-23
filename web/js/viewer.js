import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { LIGHTING_PRESETS } from '/shared/presets.js';

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
    this.pendingLoads = new Set();
    this.nodes = new Map(); // id -> { obj, geoKey, matKey, parent }
    this.data = null;
    this.library = { images: {} };
    this.envKey = null;

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

  // ---- scene sync -----------------------------------------------------------

  update(data) {
    this.data = data;
    const seen = new Set();
    for (const id of data.order) {
      const o = data.objects[id];
      if (!o) continue;
      seen.add(id);
      let node = this.nodes.get(id);
      const isGroup = o.type === 'group';
      if (!node || (node.obj.isGroup !== isGroup)) {
        if (node) node.obj.removeFromParent();
        node = { obj: isGroup ? new THREE.Group() : new THREE.Mesh(), geoKey: null, matKey: null };
        node.obj.userData.forgeId = id;
        this.nodes.set(id, node);
      }
      const obj = node.obj;
      obj.name = o.name;
      if (!isGroup) {
        const geoKey = o.type + JSON.stringify(o.params);
        if (geoKey !== node.geoKey) {
          obj.geometry?.dispose();
          obj.geometry = buildGeometry(o.type, o.params);
          node.geoKey = geoKey;
        }
        const matKey = JSON.stringify(o.material) + o.type + (o.material.texture ? this.library.images[o.material.texture]?.file : '');
        if (matKey !== node.matKey) {
          obj.material?.dispose?.();
          obj.material = this.buildMaterial(o);
          node.matKey = matKey;
        }
        obj.castShadow = true;
        obj.receiveShadow = true;
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

  buildMaterial(o) {
    const m = o.material;
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(m.color),
      metalness: m.metalness,
      roughness: m.roughness,
      emissive: new THREE.Color(m.emissive ?? '#000000'),
      emissiveIntensity: m.emissiveIntensity ?? 1,
      transmission: m.transmission ?? 0,
      ior: m.ior ?? 1.5,
      thickness: m.thickness ?? 0,
      clearcoat: m.clearcoat ?? 0,
      clearcoatRoughness: 0.15,
      flatShading: !!m.flatShading,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (m.opacity < 1) {
      mat.transparent = true;
      mat.opacity = m.opacity;
    }
    if (m.texture) {
      const asset = this.library.images[m.texture];
      if (asset) {
        mat.map = this.loadTexture(asset, m.textureRepeat ?? [1, 1]);
        if (o.type === 'image') mat.alphaTest = 0.5;
      }
    }
    return mat;
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
    this.setBackground(env.background ?? preset.background);
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
  }

  setBackground(bg) {
    if (!bg || bg === 'transparent') {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.scene.background = new THREE.Color(bg);
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
    const box = new THREE.Box3().setFromObject(this.content);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 2 : Math.max(1, box.getBoundingSphere(new THREE.Sphere()).radius * 1.6);
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

  draw(camera = this.camera) {
    this.renderer.render(this.scene, camera);
  }

  frameCamera(camera, view, targetId) {
    const target = targetId ? this.nodes.get(targetId)?.obj : this.content;
    const box = new THREE.Box3().setFromObject(target ?? this.content);
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

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width * ss, height * ss, false);
    this.renderer.render(this.scene, cam);

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
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
    return { glb: bufferToBase64(result) };
  }

  objectById(id) {
    return this.nodes.get(id)?.obj ?? null;
  }
}

export function buildGeometry(type, p) {
  switch (type) {
    case 'box': {
      const r = Math.min(p.bevel, Math.min(p.width, p.height, p.depth) / 2 - 1e-4);
      return r > 0
        ? new RoundedBoxGeometry(p.width, p.height, p.depth, Math.max(1, Math.round(p.bevelSegments)), r)
        : new THREE.BoxGeometry(p.width, p.height, p.depth);
    }
    case 'sphere': return new THREE.SphereGeometry(p.radius, p.segments, Math.max(4, Math.round(p.segments / 2)));
    case 'cylinder': return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.segments);
    case 'cone': return new THREE.ConeGeometry(p.radius, p.height, p.segments);
    case 'torus': return new THREE.TorusGeometry(p.radius, p.tube, Math.max(8, Math.round(p.segments / 2)), p.segments * 2);
    case 'capsule': return new THREE.CapsuleGeometry(p.radius, p.length, 8, p.segments);
    case 'plane': case 'image': return new THREE.PlaneGeometry(p.width, p.height);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
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
