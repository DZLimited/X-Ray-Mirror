// Places BodyParts3D hand bones on your tracked hands.
//
// 1) Where is the hand in 3D?  MediaPipe gives two things per hand:
//    - image landmarks (where each joint is on screen)
//    - world landmarks (the true 3D shape of the hand in metres, but centred on the hand,
//      so it doesn't say how far away the hand is)
//    We find the distance at which the true-size hand projects to the same size on screen
//    (same camera as the head: 63° vertical field of view). Each joint is then placed on the
//    camera ray through its 2D point, at the depth the 3D shape gives it.
//
// 2) Where does each bone go?  Each finger bone sits between two joints (see hand_meta.json).
//    The bone mesh is stored in a local frame (origin = first joint, +Y = towards the next
//    joint). Each frame we build the same local frame from your joints and scale the bone
//    to your bone length. Wrist bones + metacarpals move together in a "palm" frame.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import handMeta from './handMeta.json';
import { createSharedUniforms, createAnatomyMaterial, setMaterialLook } from './materials.js';
import { adaptiveAlpha } from './smooth.js';

export const HAND_BONES_URL = `${import.meta.env.BASE_URL}models/hand.glb`;
const DEG = Math.PI / 180;
const FOV = 63; // must match the head camera

/** Load the bone meshes and build two hand rigs (right + left). */
export async function createHands() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(HAND_BONES_URL);

  // Hands get their own uniforms: same look as the skull, but never cut by the face lens.
  const shared = createSharedUniforms();
  const material = createAnatomyMaterial(shared, { xray: 0xe6f0ff, rim: 0.5, rimPow: 2.0, fill: 0.05, solid: 0xe9e2d0 });

  // Collect bone nodes by key ("palm", "index_prox", ...).
  const byKey = new Map();
  gltf.scene.traverse((node) => {
    if (!node.name?.includes('|')) return;
    const key = node.name.split('|')[0];
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(node);
  });

  const root = new THREE.Group();
  root.name = 'hands';

  const makeRig = (name) => {
    const rig = { group: new THREE.Group(), bones: {}, joints: null, smooth: null };
    rig.group.name = name;
    for (const [key, nodes] of byKey) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      for (const n of nodes) {
        const c = n.clone(true);
        c.traverse((m) => {
          if (m.isMesh) {
            m.material = material;
            m.frustumCulled = false; // we move the parent by hand; skip stale bounds
          }
        });
        g.add(c);
      }
      rig.group.add(g);
      rig.bones[key] = g;
    }
    rig.group.visible = false;
    root.add(rig.group);
    return rig;
  };

  const rigs = { right: makeRig('rightHand'), left: makeRig('leftHand') };

  // Scratch objects (no allocations per frame).
  const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
  const palmX = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const mirror = new THREE.Matrix4().makeScale(1, 1, -1);

  function poseRig(rig, J, isLeft, thickness = 1) {
    // Palm frame: Y wrist->middle MCP, X little MCP->index MCP, Z = X x Y.
    vy.subVectors(J[9], J[0]);
    const palmLen = vy.length();
    vy.normalize();
    palmX.subVectors(J[5], J[17]);
    palmX.addScaledVector(vy, -palmX.dot(vy)).normalize();
    vz.crossVectors(palmX, vy).normalize();
    setBone(rig.bones.palm, palmX, vy, vz, J[0], palmLen / handMeta.palm.restLength, isLeft, 1);

    for (const [key, seg] of Object.entries(handMeta.segments)) {
      const a = J[seg.a], b = J[seg.b];
      vy.subVectors(b, a);
      const len = vy.length();
      if (len < 1e-4) continue;
      vy.multiplyScalar(1 / len);
      vz.crossVectors(palmX, vy);
      if (vz.lengthSq() < 1e-6) continue;
      vz.normalize();
      vx.crossVectors(vy, vz);
      setBone(rig.bones[key], vx, vy, vz, a, len / seg.restLength, isLeft, thickness);
    }
  }

  const xAxis = new THREE.Vector3();
  const sv = new THREE.Vector3();
  // thickness < 1 makes finger bones slimmer without changing their length (local y = length).
  function setBone(g, x, y, z, origin, scale, isLeft, thickness) {
    if (!g) return;
    xAxis.copy(x);
    m.makeBasis(xAxis, y, z);
    // The model is a right hand; a left hand is its mirror image (flip local z).
    if (isLeft) m.multiply(mirror);
    m.scale(sv.set(scale * thickness, scale, scale * thickness));
    m.setPosition(origin);
    g.matrix.copy(m);
    g.matrixWorldNeedsUpdate = true;
  }

  const lerp = (a, b, t) => a.clone().lerp(b, t);
  const firstRig = () =>
    rigs.right.group.visible && rigs.right.smooth
      ? rigs.right
      : rigs.left.group.visible && rigs.left.smooth
        ? rigs.left
        : null;

  return {
    root,
    material,
    shared,

    /** Label anchors (camera space) for the first visible hand, like the original video. */
    getAnchors() {
      const rig = firstRig();
      if (!rig) return [];
      const J = rig.smooth;
      return [
        { text: 'Distal phalanx', point: lerp(J[11], J[12], 0.5) },
        { text: 'Middle phalanx', point: lerp(J[10], J[11], 0.5) },
        { text: 'Proximal phalanx', point: lerp(J[9], J[10], 0.5) },
        { text: 'Metacarpal', point: lerp(J[0], J[9], 0.62) },
        { text: 'Carpal bones (wrist)', point: lerp(J[0], J[9], 0.12) },
      ];
    },

    /** Index fingertip of the first visible hand (camera space), or null. Drives the lens. */
    getFingertip() {
      return firstRig()?.smooth[8] ?? null;
    },

    /** Wrist positions (camera space) of the hands that are showing: { left, right } (or null). */
    getWrists() {
      const w = (side) => (rigs[side].group.visible && rigs[side].smooth ? rigs[side].smooth[0] : null);
      return { left: w('left'), right: w('right') };
    },

    /** Which hands are showing, e.g. ['right']. For the tracking data box. */
    visibleSides() {
      return ['right', 'left'].filter((s) => rigs[s].group.visible);
    },

    /**
     * hands: from handTracker.detect(); width/height: video size; opts: UI options
     */
    update(hands, width, height, opts) {
      setMaterialLook(material, opts.look);
      shared.uBrightness.value = opts.brightness ?? 1;
      shared.uOpacity.value = 1 - (opts.realMe ?? 0);
      shared.uEdgeFeather.value = opts.edgeFeather ?? 0;

      const seen = { right: false, left: false };
      if (opts.hands) {
        for (const h of hands ?? []) {
          if (!h.world) continue;
          // MediaPipe's label matches the real hand for our (un-mirrored) camera frames.
          // Checked with a rendered right hand: label "Right", and the palm direction from its
          // 3D points matches the right-hand bone model. "Swap left/right" is there just in case.
          let side = h.label === 'Left' ? 'left' : 'right';
          if (opts.swapHands) side = side === 'right' ? 'left' : 'right';
          if (seen[side]) side = side === 'right' ? 'left' : 'right'; // two of the same: use the other rig
          seen[side] = true;

          const rig = rigs[side];
          const J = handJointsInCamera(h.landmarks, h.world, width, height);
          // Smooth joints a little (less than the head: hands move fast).
          if (!rig.smooth) rig.smooth = J.map((p) => p.clone());
          else {
            // Adaptive: steady when the hand is still, quick when it moves (2 cm/frame = fast).
            const a = adaptiveAlpha(rig.smooth[0].distanceTo(J[0]), 2, opts.smoothing ?? 0.5);
            rig.smooth.forEach((p, i) => p.lerp(J[i], a));
          }
          poseRig(rig, rig.smooth, side === 'left', opts.fingerThickness ?? 1);
          rig.group.visible = true;
        }
      }
      for (const side of ['right', 'left']) {
        if (!seen[side]) {
          rigs[side].group.visible = false;
          rigs[side].smooth = null;
        }
      }
      return (seen.right ? 1 : 0) + (seen.left ? 1 : 0);
    },
  };
}

/**
 * 21 joints in three.js camera space (cm): x right, y up, camera looking down -z.
 * Finds the hand's distance so its true size (world landmarks) matches its size on screen.
 */
export function handJointsInCamera(lm, world, W, H) {
  const f = H / 2 / Math.tan((FOV / 2) * DEG); // focal length in pixels
  const cx = W / 2, cy = H / 2;
  const n = lm.length;

  // World landmarks: metres, x right, y down, z away from the camera. -> cm
  const w = world.map((p) => [p.x * 100, p.y * 100, p.z * 100]);
  const img = lm.map((p) => [p.x * W, p.y * H]);
  const mean = (arr, k) => arr.reduce((s, p) => s + p[k], 0) / n;
  const rms = (arr, mx, my) => Math.sqrt(arr.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / n);

  const mix = mean(img, 0), miy = mean(img, 1);
  const rmsImg = rms(img, mix, miy);
  const mwx = mean(w, 0), mwy = mean(w, 1);

  // First guess (weak perspective), then refine with the full perspective projection.
  let Tz = (f * rms(w, mwx, mwy)) / Math.max(rmsImg, 1);
  let Tx = ((mix - cx) * Tz) / f - mwx;
  let Ty = ((miy - cy) * Tz) / f - mwy;
  const proj = new Array(n);
  for (let it = 0; it < 4; it++) {
    for (let i = 0; i < n; i++) {
      const z = Math.max(w[i][2] + Tz, 1);
      proj[i] = [(f * (w[i][0] + Tx)) / z + cx, (f * (w[i][1] + Ty)) / z + cy];
    }
    const mpx = mean(proj, 0), mpy = mean(proj, 1);
    Tz *= rms(proj, mpx, mpy) / Math.max(rmsImg, 1);
    Tx += ((mix - mpx) * Tz) / f;
    Ty += ((miy - mpy) * Tz) / f;
  }

  // MediaPipe's 3D hand shape doesn't exactly match its own 2D points (fingertips can be
  // ~20-50 px off). So: put every joint exactly on the camera ray through its 2D point,
  // and take only its *depth* from the 3D shape. Bones then line up on screen exactly.
  return img.map((q, i) => {
    const z = Math.max(w[i][2] + Tz, 5);
    return new THREE.Vector3(((q[0] - cx) * z) / f, -((q[1] - cy) * z) / f, -z);
  });
}
