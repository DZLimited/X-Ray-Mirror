// Plain-JS wrapper around MediaPipe PoseLandmarker (33 body points, one person).
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;

// "lite" = fastest (~5.8 MB, downloaded once). Accuracy is plenty for placing bones.
export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export async function createPoseTracker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  let landmarker;
  let delegate = 'GPU';
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU not available for pose tracking, using CPU:', err);
    delegate = 'CPU';
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }

  let lastTime = -1;
  return {
    delegate,
    /**
     * Returns { ms, pose } where pose is null or
     *  { landmarks: 33 points (x/y 0..1, visibility 0..1), world: 33 points in metres (centred on the hips) }
     */
    detect(video, timeMs) {
      if (timeMs <= lastTime) timeMs = lastTime + 1;
      lastTime = timeMs;
      const t0 = performance.now();
      const res = landmarker.detectForVideo(video, timeMs);
      const ms = performance.now() - t0;
      const lm = res.landmarks?.[0];
      return { ms, pose: lm ? { landmarks: lm, world: res.worldLandmarks?.[0] } : null };
    },
    close() {
      landmarker.close();
    },
  };
}
