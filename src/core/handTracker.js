// Plain-JS wrapper around MediaPipe HandLandmarker (up to 2 hands).
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;

// ~7.5 MB, downloaded from Google once and cached. Only the model is downloaded; video stays local.
export const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function createHandTracker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  let landmarker;
  let delegate = 'GPU';
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU not available for hand tracking, using CPU:', err);
    delegate = 'CPU';
    landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
  }

  let lastTime = -1;
  return {
    delegate,
    /**
     * Returns { ms, hands: [{ landmarks, world, label, score }] }
     *  landmarks: 21 points, x/y in 0..1 of the frame
     *  world:     21 points in metres, centred on the hand (true 3D shape and size)
     *  label:     'Left' | 'Right' (matches the real hand for un-mirrored camera frames)
     */
    detect(video, timeMs) {
      if (timeMs <= lastTime) timeMs = lastTime + 1;
      lastTime = timeMs;
      const t0 = performance.now();
      const res = landmarker.detectForVideo(video, timeMs);
      const ms = performance.now() - t0;
      const hands = (res.landmarks ?? []).map((landmarks, i) => ({
        landmarks,
        world: res.worldLandmarks?.[i],
        label: res.handedness?.[i]?.[0]?.categoryName ?? 'Right',
        score: res.handedness?.[i]?.[0]?.score ?? 0,
      }));
      return { ms, hands };
    },
    close() {
      landmarker.close();
    },
  };
}
