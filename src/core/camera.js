// Plain-JS camera helpers. No React here on purpose:
// later phases (face tracking, three.js) will use these directly every frame.

/** Start the webcam and attach it to a <video> element. Returns the MediaStream. */
export async function startCamera(videoEl, { deviceId, width = 1280, height = 720 } = {}) {
  if (!window.isSecureContext) {
    throw new CameraError(
      'insecure',
      'The camera only works on https:// or http://localhost. Open the page from localhost.'
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'This browser does not support camera access. Try Chrome or Edge.');
  }

  const size = { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } };
  const constraints = {
    audio: false,
    video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size },
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    throw toCameraError(err);
  }

  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true; // needed on iPhone

  // Wait until the video actually has frames (width/height known).
  await new Promise((resolve) => {
    if (videoEl.readyState >= 2) return resolve();
    videoEl.onloadeddata = () => resolve();
  });
  await videoEl.play();

  return stream;
}

/** Stop every track so the camera light turns off. */
export function stopCamera(stream, videoEl) {
  stream?.getTracks().forEach((t) => t.stop());
  if (videoEl) videoEl.srcObject = null;
}

/** List video inputs. Labels are only filled in after permission was granted once. */
export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/**
 * Call `onFrame(now, video)` once per new camera frame.
 * Uses requestVideoFrameCallback when available (fires exactly on new frames),
 * otherwise falls back to requestAnimationFrame. Returns a stop() function.
 * Phase 2 will run face tracking inside this loop.
 */
export function onVideoFrames(videoEl, onFrame) {
  let running = true;
  let handle;
  const useRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  const tick = (now) => {
    if (!running) return;
    onFrame(now, videoEl);
    handle = useRVFC ? videoEl.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  };
  handle = useRVFC ? videoEl.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);

  return () => {
    running = false;
    if (useRVFC) videoEl.cancelVideoFrameCallback?.(handle);
    else cancelAnimationFrame(handle);
  };
}

export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function toCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera permission was blocked. Click the camera icon in the address bar and allow it.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('notfound', 'No camera was found. Plug one in or pick another camera.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', 'The camera is in use by another app (Zoom, Teams, OBS…). Close it and try again.');
    default:
      return new CameraError('unknown', `Could not start the camera: ${err?.message || err}`);
  }
}
