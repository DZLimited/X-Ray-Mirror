// Draws the tracked face on a 2D canvas. Plain JS, called every frame.
import { FaceLandmarker } from '@mediapipe/tasks-vision';

const C = FaceLandmarker;

/** Resize the canvas to match the video's real pixel size (only when it changes). */
export function syncCanvasSize(canvas, video) {
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

export function clearCanvas(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * opts: { mesh: bool, points: bool, features: bool }
 */
export function drawFace(canvas, landmarks, opts) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;

  const line = (connections, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const { start, end } of connections) {
      const a = landmarks[start];
      const b = landmarks[end];
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
    }
    ctx.stroke();
  };

  if (opts.mesh) line(C.FACE_LANDMARKS_TESSELATION, 'rgba(143,195,230,0.28)', 1);

  if (opts.features) {
    line(C.FACE_LANDMARKS_FACE_OVAL, 'rgba(230,240,250,0.9)', 2);
    line(C.FACE_LANDMARKS_LEFT_EYE, '#8fc3e6', 2);
    line(C.FACE_LANDMARKS_RIGHT_EYE, '#8fc3e6', 2);
    line(C.FACE_LANDMARKS_LEFT_EYEBROW, '#8fc3e6', 2);
    line(C.FACE_LANDMARKS_RIGHT_EYEBROW, '#8fc3e6', 2);
    line(C.FACE_LANDMARKS_LIPS, '#e6a38f', 2);
    line(C.FACE_LANDMARKS_LEFT_IRIS, '#f2d27a', 2);
    line(C.FACE_LANDMARKS_RIGHT_IRIS, '#f2d27a', 2);
  }

  if (opts.points) {
    ctx.fillStyle = 'rgba(200,230,255,0.85)';
    for (const p of landmarks) {
      ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2);
    }
  }
}

/**
 * Darken the video so the x-ray glow stands out. With a lens, only inside the lens
 * (soft edge); without, the whole frame. Drawn *under* any debug lines.
 * lens: { x, y, r, feather } in video pixels (top-left origin) or null.
 */
export function drawDim(canvas, lens, amount) {
  if (amount <= 0) return;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  if (lens) {
    const inner = lens.r * (1 - lens.feather);
    const g = ctx.createRadialGradient(lens.x, lens.y, inner, lens.x, lens.y, lens.r);
    g.addColorStop(0, `rgba(0,0,0,${amount})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lens.x, lens.y, lens.r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = `rgba(0,0,0,${amount})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}

const HAND_CHAINS = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [5, 9, 10, 11, 12],
  [9, 13, 14, 15, 16],
  [13, 17, 18, 19, 20],
  [0, 17],
];

/** Debug: draw MediaPipe's 21 hand points (on top of whatever is on the canvas). */
export function drawHands(canvas, hands) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  for (const hand of hands ?? []) {
    const p = hand.landmarks;
    ctx.strokeStyle = 'rgba(255,179,92,0.9)';
    ctx.lineWidth = 2;
    for (const chain of HAND_CHAINS) {
      ctx.beginPath();
      chain.forEach((i, k) => (k ? ctx.lineTo(p[i].x * w, p[i].y * h) : ctx.moveTo(p[i].x * w, p[i].y * h)));
      ctx.stroke();
    }
    ctx.fillStyle = '#ffb35c';
    for (const q of p) ctx.fillRect(q.x * w - 3, q.y * h - 3, 6, 6);
  }
}
