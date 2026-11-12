// three.js layer that follows the head. Plain JS, called every frame.
//
// How the alignment works:
// MediaPipe's head matrix maps a "canonical face" (centimetres, origin inside the head,
// +x = face's left, +y = up, +z = out of the nose) into camera space. MediaPipe computes it
// assuming a perspective camera with a 63° vertical field of view, near 1, far 10000,
// looking down -z. If our three.js camera uses exactly the same settings and our canvas has
// the same size as the video, anything we put in "head space" lands on the real head.
import * as THREE from 'three';
import canonicalFace from './canonicalFace.json';
import { applyAnatomyOptions, revealContains } from './anatomy.js';
import { createJawDriver } from './jaw.js';
import { adaptiveAlpha } from './smooth.js';
import labelDefs from './labels.json';

const MEDIAPIPE_FOV = 63;
const NEAR = 1;
const FAR = 10000;

export function createHeadScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(1); // canvas pixels = video pixels; CSS does the scaling
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Lights live in camera space: the anatomy is lit from the front, like by your screen.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(150, 250, 400);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(MEDIAPIPE_FOV, 16 / 9, NEAR, FAR);

  // Everything attached to `head` moves with your head. Units: cm.
  const head = new THREE.Group();
  head.matrixAutoUpdate = false; // we set head.matrix ourselves from MediaPipe
  head.visible = false;
  scene.add(head);

  // 0) Anatomy (BodyParts3D). Added later with setAnatomy() once the model has loaded.
  //    It sits inside a `fit` group, so the "Fit to my head" sliders can scale and shift it
  //    without touching the tracking.
  let anatomy = null;
  let hands = null;
  let body = null;
  const jawDriver = createJawDriver();
  const fit = new THREE.Group();
  fit.name = 'fit';
  head.add(fit);

  // 1) The canonical face as a 3D wireframe. If alignment is right, it sits exactly on
  //    top of the 2D mesh from Phase 2. This is our proof that the 3D maths works.
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(canonicalFace.positions, 3));
  faceGeo.setIndex(canonicalFace.indices);
  const faceMask = new THREE.LineSegments(
    new THREE.WireframeGeometry(faceGeo),
    new THREE.LineBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.55 })
  );
  head.add(faceMask);

  // 2) Placeholder skull: an ellipsoid roughly the size of an adult cranium.
  //    Replaced by the real BodyParts3D skull in Phase 4.
  const shell = new THREE.Group();
  shell.position.set(0, 2.5, -4.5);
  shell.scale.set(7.8, 9.5, 10);
  const sphere = new THREE.SphereGeometry(1, 28, 20);
  shell.add(
    new THREE.Mesh(
      sphere,
      new THREE.MeshBasicMaterial({ color: 0x8fc3e6, transparent: true, opacity: 0.1, depthWrite: false })
    ),
    new THREE.LineSegments(
      new THREE.WireframeGeometry(sphere),
      new THREE.LineBasicMaterial({ color: 0x8fc3e6, transparent: true, opacity: 0.35 })
    )
  );
  head.add(shell);

  // 3) Axes at the head's origin: red = x, green = y, blue = z (out of the nose).
  const axes = new THREE.AxesHelper(12);
  head.add(axes);

  // 4) Marker on the nose tip (canonical vertex 4).
  const p = canonicalFace.positions;
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5c7a })
  );
  nose.position.set(p[4 * 3], p[4 * 3 + 1], p[4 * 3 + 2]);
  head.add(nose);

  // ---- smoothing (reduces jitter) ----
  const target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() };
  const smooth = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), has: false };
  const tmp = new THREE.Matrix4();

  let width = 0;
  let height = 0;

  // X-ray lens: a circle that follows the face. Centre between the eyes, size from face height.
  const lens = { on: false, x: 0, y: 0, r: 0, feather: 0.3 };
  const LENS_CENTER = new THREE.Vector3(0, 1.5, 4);
  const FACE_TOP = new THREE.Vector3(0, 8.3, 4.5);
  const FACE_BOTTOM = new THREE.Vector3(0, -9.4, 4.3);
  const toScreen = (p, out) => {
    v.copy(p).applyMatrix4(fit.matrixWorld).project(camera);
    out.x = ((v.x + 1) / 2) * width;
    out.y = ((v.y + 1) / 2) * height; // bottom-left origin, like gl_FragCoord
    return out;
  };
  const sA = { x: 0, y: 0 }, sB = { x: 0, y: 0 }, sC = { x: 0, y: 0 };
  const lp = new THREE.Vector3(), ln = new THREE.Vector3(), lv = new THREE.Vector3();

  // Handheld mirror: copy its position into the shader uniforms of the head AND the hands,
  // so everything is only visible behind the glass.
  let mirror = null;
  function applyMirror(opts) {
    const on = opts.reveal === 'mirror' && mirror?.ready;
    const targets = [anatomy?.shared, hands?.shared, body?.shared].filter(Boolean);
    for (const u of targets) {
      if (!on) continue;
      u.uMirrorCenter.value.set(mirror.x, mirror.y);
      u.uMirrorHalf.value.set(mirror.hw, mirror.hh);
      u.uMirrorAngle.value = mirror.angle;
      // Circle = rounded rectangle with corners as big as possible.
      u.uMirrorRadius.value = mirror.shape === 'circle' ? mirror.hh : Math.min(mirror.hw, mirror.hh) * 0.18;
      u.uMirrorFeather.value = mirror.shape === 'circle' ? 2 + mirror.hh * (opts.edgeFeather ?? 0.17) * 0.25 : 2;
    }
    // Hand bones normally ignore the reveal; in mirror mode they only show behind the glass.
    if (hands) hands.shared.uReveal.value = on ? 6 : 0;
    // The body follows the mirror and the lens; the head-only cuts (halves etc.) don't apply to it.
    if (body) body.shared.uReveal.value = on ? 6 : opts.reveal === 'lens' ? 5 : 0;
  }

  const tipScreen = { x: 0, y: 0 };
  function updateLens(opts, faceFound) {
    lens.on = false;
    if (!anatomy || !width) return;
    scene.updateMatrixWorld();
    // Cuts happen in head space: give the shader the world -> head transform.
    anatomy.shared.uHeadInv.value.copy(anatomy.root.matrixWorld).invert();
    if (opts.reveal !== 'lens') return;

    // Lens size from the face size on screen (or a default if no face).
    let faceH = height * 0.45;
    if (faceFound) {
      toScreen(FACE_TOP, sA);
      toScreen(FACE_BOTTOM, sB);
      faceH = Math.hypot(sA.x - sB.x, sA.y - sB.y);
    }
    // Centre: your index fingertip if a hand is up, otherwise between your eyes.
    const tip = opts.hands && hands ? hands.getFingertip() : null;
    if (tip) {
      v.copy(tip).project(camera);
      sC.x = ((v.x + 1) / 2) * width;
      sC.y = ((v.y + 1) / 2) * height;
      lens.source = 'fingertip';
    } else if (faceFound) {
      toScreen(LENS_CENTER, sC);
      lens.source = 'face';
    } else {
      return;
    }
    lens.on = true;
    lens.r = (opts.lensSize ?? 1) * faceH * 0.55;
    lens.feather = Math.min(0.9, Math.max(0.05, (opts.edgeFeather ?? 0.17) * 2));
    lens.x = sC.x;
    lens.y = height - sC.y; // top-left origin for the 2D canvases
    for (const u of [anatomy.shared, body?.shared].filter(Boolean)) {
      u.uLensCenter.value.set(sC.x, sC.y);
      u.uLensRadius.value = lens.r;
      u.uLensFeather.value = lens.feather;
    }
  }

  // Latest unsmoothed head matrix, for auto-fit measurements.
  const rawMatrix = new THREE.Matrix4();
  let hasRaw = false;
  const v = new THREE.Vector3();
  const P0 = canonicalFace.positions;
  const CANON_H = Math.hypot(
    P0[10 * 3] - P0[152 * 3],
    P0[10 * 3 + 1] - P0[152 * 3 + 1],
    P0[10 * 3 + 2] - P0[152 * 3 + 2]
  );

  return {
    /** Match the canvas to the video's real pixel size. */
    resize(w, h) {
      if (w === width && h === height) return;
      width = w;
      height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    /**
     * matrix: MediaPipe's 4x4 head matrix (or null if no face)
     * opts: { faceMask, shell, axes, smoothing (0..0.95), skull, brain, eyes, muscles, opacity, fit*, jaw* }
     * jawOpen: MediaPipe's jawOpen score (0..1) or null
     * Returns the jaw opening actually used (0..1).
     */
    update(matrix, opts, jawOpen = null) {
      if (anatomy) applyAnatomyOptions(anatomy, opts);
      applyMirror(opts);
      const jaw = jawDriver.update(anatomy?.jaw, matrix ? jawOpen : null, opts);
      applyFit(fit, opts);
      faceMask.visible = opts.faceMask;
      shell.visible = opts.shell;
      axes.visible = opts.axes;
      nose.visible = opts.axes;

      if (!matrix) {
        head.visible = false;
        smooth.has = false;
        hasRaw = false;
      } else {
        tmp.fromArray(matrix); // column-major, same as three.js
        rawMatrix.copy(tmp);
        hasRaw = true;
        tmp.decompose(target.pos, target.quat, target.scale);

        // Adaptive: heavy smoothing while you hold still, little while you move.
        let a = 1;
        if (smooth.has) {
          const move = smooth.pos.distanceTo(target.pos) / 1.2; // 1.2 cm per frame = fast
          const turn = smooth.quat.angleTo(target.quat) / (3 * (Math.PI / 180)); // 3 deg per frame = fast
          a = adaptiveAlpha(Math.max(move, turn), 1, opts.smoothing);
        }
        if (!smooth.has) {
          smooth.pos.copy(target.pos);
          smooth.quat.copy(target.quat);
          smooth.has = true;
        } else {
          smooth.pos.lerp(target.pos, a);
          smooth.quat.slerp(target.quat, a);
        }

        head.matrix.compose(smooth.pos, smooth.quat, target.scale);
        head.matrixWorldNeedsUpdate = true;
        head.visible = true;
      }
      updateLens(opts, !!matrix);
      if (body) {
        scene.updateMatrixWorld();
        body.updateNeck(head.visible && anatomy ? anatomy.root.matrixWorld : null, opts);
      }
      renderer.render(scene, camera);
      return jaw;
    },

    /** The handheld mirror state (from mirror.js), used when Reveal = mirror. */
    setMirror(m) {
      mirror = m;
    },

    /** Add the upper-body skeleton (from createBody). Lives in camera space. */
    setBody(b) {
      if (body) scene.remove(body.root);
      body = b;
      if (b) scene.add(b.root);
    },

    /** Place torso + arms for this frame (call before update()). */
    updateBody(pose, opts) {
      return body ? body.update(pose, width, height, opts, opts.hands && hands ? hands.getWrists() : null) : false;
    },

    /** Add the hand rigs (from createHands). They live in camera space, not on the head. */
    setHands(h) {
      if (hands) scene.remove(hands.root);
      hands = h;
      if (h) scene.add(h.root);
    },

    /** Place hand bones for this frame. Returns how many hands are shown. */
    updateHands(handResults, opts) {
      return hands ? hands.update(handResults, width, height, opts) : 0;
    },

    /**
     * Labels for this frame: [{ text, x, y }] in video pixels (top-left origin, NOT mirrored).
     * Only for visible layers. In Solid look, labels on the far side of the head are hidden.
     */
    getLabels(opts) {
      const out = [];
      scene.updateMatrixWorld();
      const headLabels = head.visible && anatomy ? labelDefs : [];
      const jawPivot = anatomy?.meta.jawPivot;
      for (const L of headLabels) {
        if (!opts[L.layer]) continue;
        if (!revealContains(opts, L.anchor)) continue; // e.g. "Lower face only" hides forehead labels
        lp.fromArray(L.anchor);
        if (L.jaw) {
          // Jaw labels ride on the jaw: anchor relative to the hinge, then the jaw's transform.
          lp.x -= jawPivot[0]; lp.y -= jawPivot[1]; lp.z -= jawPivot[2];
          lp.applyMatrix4(anatomy.jaw.matrixWorld);
        } else {
          lp.applyMatrix4(anatomy.root.matrixWorld);
        }
        if (opts.look === 'solid') {
          // Facing test: outward direction (rotated with the head) vs direction to the camera.
          ln.fromArray(L.normal).transformDirection(head.matrixWorld);
          if (ln.dot(lv.copy(lp).negate().normalize()) < 0.05) continue;
        }
        lp.project(camera);
        if (lp.z > 1) continue;
        out.push({ text: L.text, x: ((lp.x + 1) / 2) * width, y: ((1 - lp.y) / 2) * height });
      }
      if (opts.body && body) {
        for (const a of body.getAnchors()) {
          lp.copy(a.point).project(camera);
          if (lp.z > 1) continue;
          out.push({ text: a.text, x: ((lp.x + 1) / 2) * width, y: ((1 - lp.y) / 2) * height, body: true });
        }
      }
      if (opts.hands && hands) {
        for (const a of hands.getAnchors(opts)) {
          lp.copy(a.point).project(camera);
          if (lp.z > 1) continue;
          out.push({ text: a.text, x: ((lp.x + 1) / 2) * width, y: ((1 - lp.y) / 2) * height, hand: true });
        }
      }
      return out;
    },

    /** Head centre + half-width on screen (video pixels, not mirrored), for label columns. */
    getHeadBox() {
      if (!head.visible) return null;
      scene.updateMatrixWorld();
      toScreen(LENS_CENTER, sC);
      toScreen(FACE_TOP, sA);
      toScreen(FACE_BOTTOM, sB);
      const faceH = Math.hypot(sA.x - sB.x, sA.y - sB.y);
      return { x: sC.x, y: height - sC.y, halfWidth: faceH * 0.5 };
    },

    /** Current lens on screen (top-left origin, video pixels), or null. For the 2D dim layer. */
    getLens() {
      return lens.on ? lens : null;
    },

    /** Put the loaded anatomy (from loadAnatomy) on the head. */
    setAnatomy(a) {
      if (anatomy) fit.remove(anatomy.root);
      anatomy = a;
      if (a) fit.add(a.root);
    },

    /**
     * One auto-fit sample from the current frame: compares where MediaPipe's average face
     * *would* be on screen with where your real face landmarks *are*.
     * Returns { width, height, x, y } (ratios and cm offsets in slider units) or null.
     */
    measureFit(landmarks) {
      if (!hasRaw || !landmarks || !width) return null;
      const px = (i) => {
        v.fromArray(canonicalFace.positions, i * 3).applyMatrix4(rawMatrix).project(camera);
        return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
      };
      const lm = (i) => [landmarks[i].x * width, landmarks[i].y * height];
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

      // Width: face sides near the ears (234, 454). Height: top of forehead (10) to chin (152).
      const pL = px(234), pR = px(454), pT = px(10), pB = px(152);
      const oL = lm(234), oR = lm(454), oT = lm(10), oB = lm(152);
      const projW = dist(pL, pR), projH = dist(pT, pB);
      if (projW < 20 || projH < 20) return null;

      const w = dist(oL, oR) / projW;
      const h = dist(oT, oB) / projH;

      // Offsets: how far the real face centre is from the average face centre, in cm.
      const cmPerPx = CANON_H / projH;
      const P = canonicalFace.positions;
      const canonMidY = (P[10 * 3 + 1] + P[152 * 3 + 1]) / 2;
      const dyPx = mid(oT, oB)[1] - mid(pT, pB)[1];
      const dxPx = mid(oL, oR)[0] - mid(pL, pR)[0];
      // Screen down = head -y. Scaling the height also moves the centre, so remove that part.
      const y = -dyPx * cmPerPx - (h - 1) * canonMidY;
      // Raw image +x = head +x; slider +x = right in the mirrored view = head -x.
      const x = -dxPx * cmPerPx;
      return { width: w, height: h, x, y };
    },

    clear() {
      head.visible = false;
      smooth.has = false;
      renderer.clear();
    },

    dispose() {
      renderer.dispose();
    },
  };
}

/** Fit sliders -> fit group. Sizes are ratios (1 = 100%), offsets in cm. */
function applyFit(fit, o) {
  const size = o.fitSize ?? 1;
  fit.scale.set(size * (o.fitWidth ?? 1), size * (o.fitHeight ?? 1), size * (o.fitDepth ?? 1));
  // Slider "left/right" is in mirrored screen terms: + = towards the right of the screen = head -x.
  fit.position.set(-(o.fitX ?? 0), o.fitY ?? 0, o.fitZ ?? 0);
}
