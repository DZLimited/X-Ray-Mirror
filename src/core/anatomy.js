// Loads the anatomy model (BodyParts3D, already converted into head space) and
// organises it into layers we can switch on and off.
//
// The model file was prepared offline (see pipeline/README.md):
//   - BodyParts3D meshes, moved into MediaPipe's canonical head space (cm)
//   - fitted onto MediaPipe's canonical face using the anatomy's own skin (ICP, ~2 mm error)
//   - simplified to ~207k triangles, compressed with meshopt (~1 MB)
// Every part is a named node "group|part name", e.g. "cranium|frontal bone".
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import headMeta from './headMeta.json';
import { createSharedUniforms, createAnatomyMaterial, createDimMaterial, setMaterialLook, REVEAL } from './materials.js';

export const HEAD_MODEL_URL = `${import.meta.env.BASE_URL}models/head.glb`;

// Which file groups go into which UI layer.
const LAYER_OF = {
  cranium: 'skull',
  jaw: 'skull',
  brain: 'brain',
  eyes: 'eyes',
  muscles: 'muscles',
  musclesJaw: 'muscles',
  outline: 'outline',
};

// Per layer: x-ray glow colour, outline strength (rim), outline sharpness (rimPow), faint fill,
// and the solid colour. Tuned to look like the original video. The brain has 73 parts that
// stack up, so each one adds little.
const LOOK = {
  skull: { xray: 0xd6e9ff, rim: 0.42, rimPow: 2.2, fill: 0.03, solid: 0xe9e2d0 },
  brain: { xray: 0xc0569e, rim: 0.16, rimPow: 1.6, fill: 0.016, solid: 0xe8a3b5 },
  eyes: { xray: 0x9d6bff, rim: 0.7, rimPow: 1.6, fill: 0.08, solid: 0xf4f4f0 },
  muscles: { xray: 0xff5a48, rim: 0.3, rimPow: 2.5, fill: 0.01, solid: 0xc4564a, layerAlpha: 0.75 },
  // Head outline: only the true silhouette edge glows (high rimPow), so it never floods the face.
  outline: { xray: 0x2f63ff, rim: 0.85, rimPow: 6.0, fill: 0.0, solid: 0xd9a58b, layerAlpha: 0.25, neckFade: true },
};
// Draw order for solid mode: skin outline last and faint, muscles over bone.
const RENDER_ORDER = { skull: 0, eyes: 1, brain: 1, muscles: 2, outline: 3 };

/**
 * Returns {
 *   root:     THREE.Group to add under the head (already in head space, cm),
 *   jaw:      THREE.Group whose origin is the jaw hinge (rotate .rotation.x in Phase 6),
 *   layers:   { skull: [meshes], brain: [...], eyes: [...], muscles: [...] },
 *   parts:    Map(name -> { mesh, layer, group }),
 *   materials
 * }
 */
export async function loadAnatomy(onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const gltf = await loader.loadAsync(HEAD_MODEL_URL, (e) => {
    if (onProgress && e.total) onProgress(e.loaded / e.total);
  });

  const root = new THREE.Group();
  root.name = 'anatomy';
  root.add(gltf.scene);
  root.updateMatrixWorld(true);

  // Jaw hinge group: placed at the mandible condyles. Lower jaw parts are moved into it,
  // keeping their exact position, so rotating this group opens the jaw around the hinge.
  const jaw = new THREE.Group();
  jaw.name = 'jawPivot';
  jaw.position.fromArray(headMeta.jawPivot);
  root.add(jaw);
  root.updateMatrixWorld(true);

  const shared = createSharedUniforms();
  const materials = Object.fromEntries(
    Object.entries(LOOK).map(([layer, look]) => [layer, createAnatomyMaterial(shared, look)])
  );
  const dimMaterial = createDimMaterial(shared);
  const dimMeshes = [];
  const layers = { skull: [], brain: [], eyes: [], muscles: [], outline: [] };
  const parts = new Map();
  const jawNodes = [];

  // Named nodes look like "cranium|frontal bone"; each holds one mesh.
  gltf.scene.traverse((node) => {
    if (!node.name || !node.name.includes('|')) return;
    const [group, partName] = node.name.split('|');
    const layer = LAYER_OF[group];
    if (!layer) return;

    node.traverse((child) => {
      if (!child.isMesh) return;
      child.material = materials[layer];
      child.renderOrder = RENDER_ORDER[layer];
      layers[layer].push(child);
      parts.set(partName, { mesh: child, layer, group });
      if (layer === 'outline') {
        // Same mesh, drawn first in black: darkens the video inside your head silhouette.
        const dim = new THREE.Mesh(child.geometry, dimMaterial);
        dim.position.copy(child.position);
        dim.quaternion.copy(child.quaternion);
        dim.scale.copy(child.scale);
        dim.renderOrder = -10;
        dimMeshes.push(dim);
      }
    });

    if (group === 'jaw' || group === 'musclesJaw') jawNodes.push(node);
  });

  for (const dim of dimMeshes) {
    const owner = layers.outline.find((m) => m.geometry === dim.geometry);
    owner.parent.add(dim);
  }

  // attach() keeps the world position while changing the parent.
  for (const node of jawNodes) jaw.attach(node);

  return { root, jaw, layers, parts, materials, shared, dimMeshes, meta: headMeta };
}

// Where each reveal mode cuts, in head-space cm, before the "Cut position" slider moves it.
const CUT_BASE = { left: 0, right: 0, top: -1, lower: -1.5 };

/**
 * Apply UI options to the anatomy.
 * opts: { skull, brain, eyes, muscles, outline, look, brightness, realMe, edgeFeather,
 *         reveal, cut (-1..1), dim }
 */
export function applyAnatomyOptions(anatomy, opts) {
  for (const [layer, meshes] of Object.entries(anatomy.layers)) {
    const visible = !!opts[layer];
    for (const m of meshes) m.visible = visible;
  }
  const xray = opts.look === 'xray';
  for (const d of anatomy.dimMeshes) d.visible = xray && (opts.dim ?? 0) > 0;
  for (const mat of Object.values(anatomy.materials)) setMaterialLook(mat, opts.look);

  const u = anatomy.shared;
  u.uBrightness.value = opts.brightness ?? 1;
  u.uOpacity.value = 1 - (opts.realMe ?? 0); // "Real me showing through"
  u.uEdgeFeather.value = opts.edgeFeather ?? 0;
  u.uDim.value = opts.dim ?? 0;

  const mode = opts.reveal ?? 'head';
  u.uReveal.value = REVEAL[mode] ?? 0;
  // Slider -1..1 = +-8 cm. Left/right: + moves the cut to the right of the screen (= head -x).
  const offset = (opts.cut ?? 0) * 8;
  if (mode === 'left' || mode === 'right') u.uCut.value = CUT_BASE[mode] - offset;
  else if (mode === 'top' || mode === 'lower') u.uCut.value = CUT_BASE[mode] + offset;
  u.uCutFeather.value = 0.4 + (opts.edgeFeather ?? 0) * 8;
}

/** Is a head-space point inside the current reveal region? (for hiding labels) */
export function revealContains(opts, p) {
  const mode = opts.reveal ?? 'head';
  const offset = (opts.cut ?? 0) * 8;
  if (mode === 'left') return p[0] > CUT_BASE.left - offset;
  if (mode === 'right') return p[0] < CUT_BASE.right - offset;
  if (mode === 'top') return p[1] > CUT_BASE.top + offset;
  if (mode === 'lower') return p[1] < CUT_BASE.lower + offset;
  return true;
}
