// Plain-JS wrapper around MediaPipe FaceLandmarker.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// WASM is served by our own app (copied by scripts/copy-mediapipe.js).
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;

// The model (~3.7 MB) is downloaded from Google the first time, then cached by the browser.
// Only the model file is downloaded. Your camera video never leaves the device.
export const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Load the face tracker. Tries the GPU first (fast), falls back to CPU.
 * Returns { detect(video, timeMs), close(), delegate }.
 */
export async function createFaceTracker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

  const options = (delegate) => ({
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true, // jawOpen, eyeBlinkLeft, ... (used for the jaw in Phase 6)
    outputFacialTransformationMatrixes: true, // head position + rotation (key for Phase 3)
  });

  let landmarker;
  let delegate = 'GPU';
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU not available for face tracking, using CPU:', err);
    delegate = 'CPU';
    landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }

  let lastTime = -1;

  return {
    delegate,
    /** Run on one video frame. Returns a simplified result, or null if no new frame. */
    detect(video, timeMs) {
      // MediaPipe needs strictly increasing timestamps.
      if (timeMs <= lastTime) timeMs = lastTime + 1;
      lastTime = timeMs;

      const t0 = performance.now();
      const res = landmarker.detectForVideo(video, timeMs);
      const ms = performance.now() - t0;

      if (!res.faceLandmarks?.length) return { found: false, ms };

      const blend = {};
      for (const c of res.faceBlendshapes?.[0]?.categories ?? []) blend[c.categoryName] = c.score;

      return {
        found: true,
        ms,
        landmarks: res.faceLandmarks[0], // 478 points, x/y in 0..1 of the frame, z = relative depth
        blendshapes: blend, // { jawOpen: 0..1, ... }
        matrix: res.facialTransformationMatrixes?.[0]?.data ?? null, // 4x4, column-major, cm units
      };
    },
    close() {
      landmarker.close();
    },
  };
}

/**
 * Turn the 4x4 head matrix into readable numbers for debugging.
 * Angles in degrees, position in cm (camera space).
 */
export function headPoseFromMatrix(m) {
  if (!m) return null;
  const deg = (r) => (r * 180) / Math.PI;
  return {
    pitch: deg(Math.atan2(m[6], m[10])), // nod up/down
    yaw: deg(Math.asin(Math.max(-1, Math.min(1, -m[2])))), // turn left/right
    roll: deg(Math.atan2(m[1], m[0])), // tilt
    x: m[12],
    y: m[13],
    z: m[14],
  };
}

// Re-exported so the drawing code can use MediaPipe's mesh connections.
export { FaceLandmarker };
