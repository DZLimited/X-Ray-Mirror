import { useEffect, useRef, useState } from 'react';
import CameraView from './components/CameraView.jsx';
import TrackingPanel from './components/TrackingPanel.jsx';
import { createFaceTracker } from './core/faceTracker.js';
import { drawFace, drawHands, syncCanvasSize, clearCanvas } from './core/drawFace.js';
import { createHeadScene } from './core/scene3d.js';
import { loadAnatomy } from './core/anatomy.js';
import { createHandTracker } from './core/handTracker.js';
import { createHands } from './core/hands3d.js';
import { createPoseTracker } from './core/poseTracker.js';
import { createBody } from './core/body3d.js';
import { drawLabels, drawLensCircle, syncLabelCanvas } from './core/drawLabels.js';
import { createMirror, drawMirrorGlass, drawMirrorFrame } from './core/mirror.js';

// "Fit to my head" values, remembered between visits in this browser.
const FIT_KEYS = ['fitSize', 'fitWidth', 'fitHeight', 'fitDepth', 'fitX', 'fitY', 'fitZ'];
export const DEFAULT_FIT = { fitSize: 1, fitWidth: 1, fitHeight: 1, fitDepth: 1, fitX: 0, fitY: 0, fitZ: 0 };
const FIT_STORAGE = 'xray-mirror-fit-v1';

function loadSavedFit() {
  try {
    const saved = JSON.parse(localStorage.getItem(FIT_STORAGE) || '{}');
    const out = { ...DEFAULT_FIT };
    for (const k of FIT_KEYS) if (Number.isFinite(saved[k])) out[k] = saved[k];
    return out;
  } catch {
    return { ...DEFAULT_FIT };
  }
}

function saveFit(opts) {
  try {
    localStorage.setItem(FIT_STORAGE, JSON.stringify(Object.fromEntries(FIT_KEYS.map((k) => [k, opts[k]]))));
  } catch {
    /* storage can be unavailable (private mode); fit just won't be remembered */
  }
}

const AUTOFIT_SAMPLES = 30;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export default function App() {
  const trackerRef = useRef(null);
  const canvasRef = useRef(null); // 2D debug drawing (Phase 2)
  const glCanvasRef = useRef(null); // three.js (Phase 3)
  const labelCanvasRef = useRef(null); // labels, not mirrored (Phase 9)
  const fpsRef = useRef({ last: 0, fps: 0 });
  const mirrorRef = useRef(null);
  // Speed-ups: remember the last pose/hand results so we can skip some detections.
  const skipRef = useRef({ frame: 0, pose: null, handsSeen: false });
  if (!mirrorRef.current) mirrorRef.current = createMirror();
  const sceneRef = useRef(null);
  const panelRef = useRef(null);
  const anatomyRef = useRef(null); // loaded BodyParts3D model (Phase 4)
  const handTrackerRef = useRef(null); // MediaPipe hands (Phase 8)
  const handRigsRef = useRef(null); // hand bone meshes (Phase 8)
  const poseTrackerRef = useRef(null); // MediaPipe pose (upper body)
  const bodyRef = useRef(null); // upper-body bone meshes

  const [modelState, setModelState] = useState('loading'); // loading | ready | error
  const [modelError, setModelError] = useState('');
  const [delegate, setDelegate] = useState('');
  const [anatomyState, setAnatomyState] = useState('loading 0%');
  const [handsState, setHandsState] = useState('off');
  const [bodyState, setBodyState] = useState('off');

  // Options live in React state (for the UI) AND in a ref (for the frame loop).
  const [options, setOptions] = useState(() => ({
    // Anatomy layers (Phase 4)
    skull: true,
    brain: true,
    eyes: true,
    muscles: false,
    outline: true,
    hands: true,
    body: true, // upper-body skeleton (shoulders, arms, ribs, spine, neck)
    swapHands: false,
    handPoints: false,
    showLabels: true,
    fingerThickness: 0.8,
    // Look + mixed reality (Phase 7)
    look: 'xray', // 'xray' | 'solid'
    brightness: 1,
    realMe: 0.2, // how much of the real you shows through the anatomy
    edgeFeather: 0.17,
    reveal: 'mirror', // mirror | head | left | right | top | lower | lens
    mirrorSize: 1,
    mirrorShape: 'circle', // 'circle' (like the original: follows your index fingertip) | 'pane' (handheld glass)
    mirrorFollow: 'hand', // 'hand' = sits in your palm when a hand is up | 'drag' = mouse/finger only
    cut: 0, // cut position for the half / top / lower reveals (-1..1)
    lensSize: 1,
    dim: 0.45, // darken your face inside the head outline (x-ray look)
    showData: false,
    // 3D debug (Phase 3)
    faceMask: false,
    shell: false,
    axes: false,
    smoothing: 0.5,
    // 2D debug (Phase 2)
    features: false,
    mesh: false,
    points: false,
    // Jaw (Phase 6)
    jawGain: 1,
    jawMaxDeg: 26,
    jawTest: 0,
    // Fit to my head (Phase 5)
    ...loadSavedFit(),
  }));
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Remember the fit whenever it changes.
  useEffect(() => saveFit(options), FIT_KEYS.map((k) => options[k]));

  // Auto-fit: collect samples over ~1 second of frames, then set the sliders.
  const autoFitRef = useRef(null); // { samples: [] } while measuring
  const [autoFitStatus, setAutoFitStatus] = useState('');

  function startAutoFit() {
    autoFitRef.current = { samples: [], frames: 0 };
    setAutoFitStatus('Look straight at the camera…');
  }

  function finishAutoFit(samples) {
    autoFitRef.current = null;
    if (samples.length < AUTOFIT_SAMPLES / 2) {
      setAutoFitStatus('Could not measure. Face the camera straight on and try again.');
      return;
    }
    const w = median(samples.map((s) => s.width));
    const h = median(samples.map((s) => s.height));
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const fit = {
      fitSize: 1,
      fitWidth: clamp(w, 0.8, 1.25),
      fitHeight: clamp(h, 0.8, 1.25),
      fitDepth: clamp((w + h) / 2, 0.8, 1.25), // depth can't be seen from the front; use the average
      fitX: clamp(median(samples.map((s) => s.x)), -3, 3),
      fitY: clamp(median(samples.map((s) => s.y)), -3, 3),
      fitZ: 0,
    };
    setOptions((o) => ({ ...o, ...fit }));
    setAutoFitStatus(`Done: width ${Math.round(fit.fitWidth * 100)}%, height ${Math.round(fit.fitHeight * 100)}%`);
  }

  // Load the face model once, while the user is still reading the start screen.
  useEffect(() => {
    let cancelled = false;
    createFaceTracker()
      .then((tracker) => {
        if (cancelled) return tracker.close();
        trackerRef.current = tracker;
        setDelegate(tracker.delegate);
        setModelState('ready');
      })
      .catch((err) => {
        console.error(err);
        setModelError(err?.message || String(err));
        setModelState('error');
      });
    return () => {
      cancelled = true;
      trackerRef.current?.close();
      trackerRef.current = null;
    };
  }, []);

  // Load the anatomy model (~1 MB) in parallel with the face model.
  useEffect(() => {
    let cancelled = false;
    loadAnatomy((p) => !cancelled && setAnatomyState(`loading ${Math.round(p * 100)}%`))
      .then((anatomy) => {
        if (cancelled) return;
        anatomyRef.current = anatomy;
        sceneRef.current?.setAnatomy(anatomy);
        setAnatomyState(`ready (${anatomy.parts.size} parts)`);
      })
      .catch((err) => {
        console.error(err);
        setAnatomyState(`error: ${err?.message || err}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hands: load the tracker + bone meshes the first time "Hand bones" is switched on.
  // Once loaded they stay loaded; switching the layer off just skips the work each frame.
  const handsLoadingRef = useRef(false);
  // Hand tracking is needed for the hand-bone layer, and for a mirror that follows your hand.
  const needHands = options.hands || (options.reveal === 'mirror' && options.mirrorFollow === 'hand');
  useEffect(() => {
    if (!needHands || handTrackerRef.current || handsLoadingRef.current) return;
    handsLoadingRef.current = true;
    setHandsState('loading');
    Promise.all([createHandTracker(), createHands()])
      .then(([tracker, rigs]) => {
        handTrackerRef.current = tracker;
        handRigsRef.current = rigs;
        sceneRef.current?.setHands(rigs);
        setHandsState('ready');
      })
      .catch((err) => {
        console.error(err);
        setHandsState(`error: ${err?.message || err}`);
      })
      .finally(() => {
        handsLoadingRef.current = false;
      });
  }, [needHands]);

  // Upper body: load the pose tracker + bones the first time the layer is switched on.
  const bodyLoadingRef = useRef(false);
  useEffect(() => {
    if (!options.body || poseTrackerRef.current || bodyLoadingRef.current) return;
    bodyLoadingRef.current = true;
    setBodyState('loading');
    Promise.all([createPoseTracker(), createBody()])
      .then(([tracker, body]) => {
        poseTrackerRef.current = tracker;
        bodyRef.current = body;
        sceneRef.current?.setBody(body);
        setBodyState('ready');
      })
      .catch((err) => {
        console.error(err);
        setBodyState(`error: ${err?.message || err}`);
      })
      .finally(() => {
        bodyLoadingRef.current = false;
      });
  }, [options.body]);

  useEffect(
    () => () => {
      poseTrackerRef.current?.close();
      handTrackerRef.current?.close();
      handTrackerRef.current = null;
    },
    []
  );

  // Runs once per camera frame. No React state is touched here.
  function handleFrame(now, video) {
    const t0 = performance.now();
    const tracker = trackerRef.current;
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (!tracker || !canvas || !glCanvas) return;

    // Create the three.js scene the first time its canvas exists.
    if (!sceneRef.current) {
      sceneRef.current = createHeadScene(glCanvas);
      if (anatomyRef.current) sceneRef.current.setAnatomy(anatomyRef.current);
      if (handRigsRef.current) sceneRef.current.setHands(handRigsRef.current);
      if (bodyRef.current) sceneRef.current.setBody(bodyRef.current);
    }
    const scene3d = sceneRef.current;

    syncCanvasSize(canvas, video);
    scene3d.resize(video.videoWidth, video.videoHeight);

    const res = tracker.detect(video, now);
    const opts = optionsRef.current;

    drawFace(canvas, res.found ? res.landmarks : null, opts);
    // Hands (before the 3D render). Skipped entirely when nothing needs them.
    let handInfo = null;
    let handResults = [];
    // The mirror needs hand tracking even if the hand-bone layer is off.
    const wantHands = opts.hands || (opts.reveal === 'mirror' && opts.mirrorFollow === 'hand');
    const skip = skipRef.current;
    skip.frame++;
    // No hand in view: only look for one every 3rd frame. Once seen, track every frame.
    const lookForHands = skip.handsSeen || skip.frame % 3 === 0;
    if (wantHands && handTrackerRef.current && lookForHands) {
      const hr = handTrackerRef.current.detect(video, now);
      skip.handsSeen = hr.hands.length > 0;
      handResults = hr.hands;
      const count = scene3d.updateHands(hr.hands, opts);
      handInfo = { ms: hr.ms, count, sides: handRigsRef.current?.visibleSides() ?? [], tip: hr.hands[0]?.landmarks[8] };
      if (opts.handPoints) drawHands(canvas, hr.hands);
    } else if (wantHands && handTrackerRef.current) {
      handInfo = { ms: 0, count: 0, sides: [], tip: null }; // skipped this frame (no hand last time)
      scene3d.updateHands([], opts);
    } else {
      scene3d.updateHands([], opts);
    }

    // Upper body (pose). Skipped when the layer is off.
    let bodyInfo = null;
    if (opts.body && poseTrackerRef.current) {
      // The body moves slower than the face: detect every 2nd frame, reuse the last pose between.
      let ms = 0;
      if (skip.frame % 2 === 0 || !skip.pose) {
        const pr = poseTrackerRef.current.detect(video, now);
        skip.pose = pr.pose;
        ms = pr.ms;
      }
      bodyInfo = { ms, found: scene3d.updateBody(skip.pose, opts) };
    } else {
      scene3d.updateBody(null, opts);
    }

    // Handheld X-ray mirror: place it (palm / drag / face), then tell the 3D scene.
    const mirrorOn = opts.reveal === 'mirror';
    if (mirrorOn) {
      const m = mirrorRef.current;
      m.update(handResults[0] ?? null, scene3d.getHeadBox(), video.videoWidth, video.videoHeight, opts);
      scene3d.setMirror(m.state);
      drawMirrorGlass(canvas, m.state); // glass tint, under the x-ray glow
    }

    const jaw = scene3d.update(res.found ? res.matrix : null, opts, res.found ? res.blendshapes.jawOpen : null);
    // Labels (after the 3D update, so they use this frame's positions).
    const labelCanvas = labelCanvasRef.current;
    if (labelCanvas) {
      syncLabelCanvas(labelCanvas, video.videoWidth, video.videoHeight);
      const lens = scene3d.getLens();
      if (lens) drawLensCircle(labelCanvas, lens);
      if (opts.showLabels) {
        let labels = scene3d.getLabels(opts);
        // Mirror: only name what you can see through the glass.
        if (mirrorOn) labels = labels.filter((l) => mirrorRef.current.contains(l.x, l.y, video.videoHeight));
        drawLabels(labelCanvas, labels, scene3d.getHeadBox());
      }
      if (mirrorOn) drawMirrorFrame(labelCanvas, mirrorRef.current.state);
    }

    // Speed (frames per second), smoothed.
    const fpsState = fpsRef.current;
    if (fpsState.last) fpsState.fps = fpsState.fps * 0.9 + (1000 / Math.max(1, now - fpsState.last)) * 0.1;
    fpsState.last = now;

    const tip = handInfo?.tip;
    panelRef.current?.update({
      res,
      jawUsed: jaw,
      frameMs: performance.now() - t0,
      fps: fpsState.fps,
      handInfo,
      bodyInfo,
      sides: handInfo?.sides ?? [],
      // Like the original: fingertip position on screen, 0..1 (mirrored, as you see it).
      fingertip: tip ? [1 - tip.x, tip.y] : null,
      layers: ['skull', 'brain', 'muscles', 'eyes', 'outline', 'hands', 'body'].filter((k) => opts[k]),
      delegate,
    });

    // Auto-fit sampling (only near-frontal frames give a fair measurement).
    const af = autoFitRef.current;
    if (af) {
      af.frames++;
      if (res.found) {
        const m = res.matrix;
        const yaw = Math.abs(Math.asin(Math.max(-1, Math.min(1, -m[2]))) * 57.3);
        const pitch = Math.abs(Math.atan2(m[6], m[10]) * 57.3);
        if (yaw < 15 && pitch < 25) {
          const sample = scene3d.measureFit(res.landmarks);
          if (sample) af.samples.push(sample);
        }
      }
      if (af.samples.length >= AUTOFIT_SAMPLES || af.frames > AUTOFIT_SAMPLES * 4) finishAutoFit(af.samples);
    }
  }

  function handleStop() {
    if (canvasRef.current) clearCanvas(canvasRef.current);
    // The canvases unmount when the camera stops, so drop the WebGL scene too.
    sceneRef.current?.setAnatomy(null); // keep the loaded model for the next start
    sceneRef.current?.setHands(null);
    sceneRef.current?.setBody(null);
    sceneRef.current?.dispose();
    sceneRef.current = null;
  }

  // Drag the mirror with the mouse or a finger. Screen position -> video pixels: undo the
  // CSS "object-fit: cover" crop and the mirroring, and flip y (the shader counts from the bottom).
  function dragMirror(e) {
    if (e.type === 'pointermove' && e.buttons === 0) return;
    const gl = glCanvasRef.current;
    if (!gl?.width) return;
    const r = e.currentTarget.getBoundingClientRect();
    const W = gl.width, H = gl.height;
    const scale = Math.max(r.width / W, r.height / H);
    const sx = (e.clientX - r.left - (r.width - W * scale) / 2) / scale; // mirrored screen x in video px
    const sy = (e.clientY - r.top - (r.height - H * scale) / 2) / scale;
    mirrorRef.current.dragTo(W - sx, H - sy);
  }
  const mirrorDragHandlers = {
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragMirror(e);
    },
    onPointerMove: dragMirror,
  };

  const blockedText =
    modelState === 'loading'
      ? 'Loading face tracking model…'
      : modelState === 'error'
        ? `Could not load the face model: ${modelError}`
        : '';

  return (
    <main className="app">
      <div className="layout">
        <CameraView
          onFrame={handleFrame}
          onStop={handleStop}
          blocked={modelState !== 'ready'}
          blockedText={blockedText}
        >
          <canvas ref={canvasRef} className="layer mirrored" />
          <canvas ref={glCanvasRef} className="layer mirrored" />
          <canvas ref={labelCanvasRef} className="layer" />
          {options.reveal === 'mirror' && <div className="layer drag-layer" {...mirrorDragHandlers} />}
        </CameraView>

        <TrackingPanel
          ref={panelRef}
          options={options} onOptionsChange={setOptions}
          delegate={delegate}
          anatomyState={anatomyState}
          handsState={handsState}
          bodyState={bodyState}
          onAutoFit={startAutoFit}
          autoFitStatus={autoFitStatus}
          onResetFit={() => {
            setOptions((o) => ({ ...o, ...DEFAULT_FIT }));
            setAutoFitStatus('');
          }}
        />
      </div>
      <footer className="credits">
        The anatomy is a real 3D dataset of one adult, scaled and pinned to your head. It shows where structures
        typically sit, not a scan of you, and it is not a medical tool. Video is processed on this computer and never
        uploaded (Google's MediaPipe library may send anonymous usage statistics, never images). Anatomy: BodyParts3D,
        © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan.
      </footer>
    </main>
  );
}
