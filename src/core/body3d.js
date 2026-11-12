// Upper-body skeleton on your tracked body (MediaPipe Pose).
//
//  torso   ribs, sternum, thoracic spine, clavicles, scapulae: one rigid frame between your
//          shoulders and hips (X = right->left shoulder, Y = up, Z = forward), scaled to your
//          shoulder width and torso length.
//  arms    humerus between shoulder and elbow; radius + ulna between elbow and wrist.
//  neck    C1..C7: each vertebra is blended between "attached to the skull" and "attached to the
//          torso" (C1 follows the head, C7 follows the chest), so the neck bends when you turn.
//
// 3D positions come from MediaPipe's pose "world" points (true size, in metres) placed on the
// camera rays through the 2D points, the same method as the hands.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import bodyMeta from './bodyMeta.json';
import { createSharedUniforms, createAnatomyMaterial, setMaterialLook } from './materials.js';
import { handJointsInCamera } from './hands3d.js';
import { adaptiveAlpha } from './smooth.js';

export const BODY_URL = `${import.meta.env.BASE_URL}models/body.glb`;

// MediaPipe Pose indices (odd = the person's LEFT).
const POSE = { shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16, hipL: 23, hipR: 24 };
const KEYS = Object.keys(POSE);
const VISIBLE = 0.45; // a point MediaPipe is less sure about than this is treated as not seen

export async function createBody() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(BODY_URL);

  const shared = createSharedUniforms();
  const material = createAnatomyMaterial(shared, { xray: 0xd6e9ff, rim: 0.42, rimPow: 2.2, fill: 0.03, solid: 0xe9e2d0 });

  const root = new THREE.Group();
  root.name = 'body';
  const groups = {}; // key -> Group (matrix set by us)
  gltf.scene.traverse((node) => {
    if (!node.name?.includes('|')) return;
    const key = node.name.split('|')[0];
    if (!groups[key]) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.visible = false;
      root.add(g);
      groups[key] = g;
    }
    const c = node.clone(true);
    c.traverse((m) => {
      if (m.isMesh) {
        m.material = material;
        m.frustumCulled = false;
      }
    });
    groups[key].add(c);
  });

  const headToTorso = new THREE.Matrix4().fromArray(bodyMeta.headToTorso);
  const torsoM = new THREE.Matrix4();
  const tmpM = new THREE.Matrix4();
  const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
  const torsoZ = new THREE.Vector3(), torsoY = new THREE.Vector3();
  const sv = new THREE.Vector3();
  let J = null; // smoothed joints (camera space, cm)
  let vis = {};
  let hasTorso = false;

  // Neck blending scratch
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
  const sA = new THREE.Vector3(), sB = new THREE.Vector3();

  function setFrame(g, x, y, z, origin, sx, sy, sz) {
    g.matrix.makeBasis(x, y, z).scale(sv.set(sx, sy, sz)).setPosition(origin);
    g.matrixWorldNeedsUpdate = true;
  }

  return {
    root,
    shared,
    material,

    /**
     * pose: from poseTracker.detect().pose (or null).
     * wrists: { left, right } from the hand tracker (camera space) or null. When a hand is
     *         tracked, the forearm ends at THAT wrist, so the arm and hand bones meet exactly.
     */
    update(pose, width, height, opts, wrists = null) {
      setMaterialLook(material, opts.look);
      shared.uBrightness.value = opts.brightness ?? 1;
      shared.uOpacity.value = 1 - (opts.realMe ?? 0);
      shared.uEdgeFeather.value = opts.edgeFeather ?? 0;

      if (!opts.body || !pose?.world) {
        for (const g of Object.values(groups)) g.visible = false;
        J = null;
        hasTorso = false;
        return false;
      }

      // Joints in camera space (cm), then smoothing.
      const idx = KEYS.map((k) => POSE[k]);
      const pts = handJointsInCamera(idx.map((i) => pose.landmarks[i]), idx.map((i) => pose.world[i]), width, height);
      if (!J) J = Object.fromEntries(KEYS.map((k, i) => [k, pts[i]]));
      else {
        // Adaptive: steady when still, quick when moving (2 cm/frame at the shoulders = fast).
        const a = adaptiveAlpha(J.shoulderL.distanceTo(pts[0]) + J.shoulderR.distanceTo(pts[1]), 4, opts.smoothing ?? 0.5);
        KEYS.forEach((k, i) => J[k].lerp(pts[i], a));
      }
      vis = Object.fromEntries(KEYS.map((k) => [k, pose.landmarks[POSE[k]].visibility ?? 1]));

      // Torso frame.
      hasTorso = vis.shoulderL > VISIBLE && vis.shoulderR > VISIBLE;
      groups.torso.visible = hasTorso;
      if (hasTorso) {
        const S = pA.addVectors(J.shoulderL, J.shoulderR).multiplyScalar(0.5);
        const Hm = pB.addVectors(J.hipL, J.hipR).multiplyScalar(0.5);
        vx.subVectors(J.shoulderL, J.shoulderR);
        const width3d = vx.length();
        vx.normalize();
        vy.subVectors(S, Hm);
        const len3d = vy.length();
        vy.addScaledVector(vx, -vy.dot(vx)).normalize();
        vz.crossVectors(vx, vy).normalize();
        const sx = width3d / bodyMeta.torso.restWidth;
        // Hips are usually out of view at a desk, and then MediaPipe only guesses them, which
        // stretches the torso. Only trust the measured length when both hips are clearly seen.
        const hipsSeen = vis.hipL > 0.7 && vis.hipR > 0.7;
        const sy = hipsSeen ? Math.min(1.1 * sx, Math.max(0.9 * sx, len3d / bodyMeta.torso.restLength)) : sx;
        setFrame(groups.torso, vx, vy, vz, S, sx, sy, (sx + sy) / 2);
        torsoM.copy(groups.torso.matrix);
        torsoZ.copy(vz);
        torsoY.copy(vy);
      }

      // Arms: each bone between two joints, rolled so its front faces the torso's front.
      for (const [key, seg] of Object.entries(bodyMeta.segments)) {
        const g = groups[key];
        let handWrist = seg.b === 'wristL' ? wrists?.left : seg.b === 'wristR' ? wrists?.right : null;
        // Only join when the hand's wrist is near where the body tracker thinks that wrist is
        // (otherwise it's probably the other hand, or a wrong left/right label).
        if (handWrist && handWrist.distanceTo(J[seg.b]) > 0.5 * seg.restLength) handWrist = null; // ~12 cm
        const end = handWrist ?? J[seg.b];
        const ok = hasTorso && vis[seg.a] > VISIBLE && (handWrist || vis[seg.b] > VISIBLE);
        g.visible = ok;
        if (!ok) continue;
        vy.subVectors(end, J[seg.a]);
        const len = vy.length();
        if (len < 1) {
          g.visible = false;
          continue;
        }
        vy.multiplyScalar(1 / len);
        vz.copy(torsoZ).addScaledVector(vy, -torsoZ.dot(vy));
        if (vz.lengthSq() < 1e-4) vz.copy(torsoY).addScaledVector(vy, -torsoY.dot(vy));
        vz.normalize();
        vx.crossVectors(vy, vz);
        const s = len / seg.restLength;
        setFrame(g, vx, vy, vz, J[seg.a], s, s, s);
      }
      return hasTorso;
    },

    /**
     * Neck: blend each vertebra between the head and the torso.
     * headWorld: the anatomy root's world matrix (head space -> world), or null if no face.
     */
    updateNeck(headWorld, opts) {
      const showNeck = opts.body && (hasTorso || headWorld);
      for (const n of bodyMeta.neck) {
        const g = groups[n.key];
        g.visible = !!showNeck;
        if (!showNeck) continue;
        // A: neck attached to the skull. B: neck attached to the torso.
        const A = headWorld ?? tmpM.multiplyMatrices(torsoM, headToTorso);
        const B = hasTorso ? tmpM.multiplyMatrices(torsoM, headToTorso) : A;
        A.decompose(pA, qA, sA);
        B.decompose(pB, qB, sB);
        const t = headWorld && hasTorso ? n.blend : headWorld ? 0 : 1;
        pA.lerp(pB, t);
        qA.slerp(qB, t);
        sA.lerp(sB, t);
        g.matrix.compose(pA, qA, sA);
        g.matrixWorldNeedsUpdate = true;
      }
    },

    /** Label anchors in camera space: [{ text, point }]. */
    getAnchors() {
      const out = [];
      for (const L of bodyMeta.labels) {
        const g = groups[L.group];
        if (!g?.visible) continue;
        const p = new THREE.Vector3().fromArray(L.point ?? L.head);
        p.applyMatrix4(g.matrix);
        out.push({ text: L.text, point: p });
      }
      return out;
    },
  };
}
