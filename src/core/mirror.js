// The handheld "X-ray mirror": a glass pane you move around. Inside it you see the x-ray,
// outside it you see the normal you.
//
// Where is the mirror?
//   - If a hand is up (and "follows my hand" is on): you hold it like a hand mirror. The glass
//     sits just ABOVE your fingertips (so your hand never covers it), with a handle down into
//     your palm, and it tilts with your hand (a bit less than your hand, so it stays readable).
//   - Otherwise it stays where you last left it; you can drag it with the mouse or a finger.
//   - Before anything else: it starts on your face.
//
// Coordinates: everything here is in UN-mirrored video pixels with y pointing UP
// (the same as gl_FragCoord in the shader). The 2D canvases convert when drawing.

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export function createMirror() {
  const m = { ready: false, x: 0, y: 0, angle: 0, hw: 120, hh: 160, source: 'none', palm: null, shape: 'circle' };
  let drag = null; // last drag position { x, y } in GL pixels
  let lastSize = 160;

  return {
    state: m,

    /** Mouse/finger drag: position in GL pixels (un-mirrored, y up). */
    dragTo(x, y) {
      drag = { x, y };
    },

    /**
     * hand: { landmarks } of the first tracked hand, or null
     * face: { x, y, halfWidth } head box from scene3d (top-left origin, un-mirrored), or null
     * W, H: video size; opts: { mirrorSize, mirrorFollow: 'hand' | 'drag' }
     */
    update(hand, face, W, H, opts) {
      const size = opts.mirrorSize ?? 1;
      let tx, ty, tAngle, tHalfH;
      const circle = (opts.mirrorShape ?? 'circle') === 'circle';
      m.shape = circle ? 'circle' : 'pane';

      if (hand && opts.mirrorFollow !== 'drag' && circle) {
        // Circle (like the original): centred on your index fingertip, sized to your face.
        const tip = hand.landmarks[8];
        tx = tip.x * W;
        ty = (1 - tip.y) * H;
        tAngle = 0;
        tHalfH = (face ? face.halfWidth * 1.45 : H * 0.24) * size; // ~0.72x face height, like the original
        m.palm = null;
        m.source = 'hand';
      } else if (hand && opts.mirrorFollow !== 'drag') {
        const L = hand.landmarks;
        const P = (i) => ({ x: L[i].x * W, y: (1 - L[i].y) * H }); // GL pixels
        const wrist = P(0), mid = P(9);
        const palm = [0, 5, 9, 13, 17].map(P).reduce((s, p) => ({ x: s.x + p.x / 5, y: s.y + p.y / 5 }), { x: 0, y: 0 });
        const ux = mid.x - wrist.x, uy = mid.y - wrist.y; // "up" = wrist -> middle knuckle
        const palmLen = Math.hypot(ux, uy) || 1;
        const dx = ux / palmLen, dy = uy / palmLen;
        // How far up the hand reaches (the furthest fingertip, measured from the wrist).
        const reach = Math.max(...[4, 8, 12, 16, 20].map((i) => (P(i).x - wrist.x) * dx + (P(i).y - wrist.y) * dy));
        // Size from your face (a mirror shows your face), or from the hand if no face is seen.
        tHalfH = (face ? face.halfWidth * 1.15 : palmLen * 1.1) * size;
        tAngle = Math.atan2(-ux, uy) * 0.6; // tilt with the hand, but only 60%
        // Glass centre: above the fingertips by a small gap + half the glass height.
        const along = reach + palmLen * 0.15 + tHalfH;
        tx = wrist.x + dx * along;
        ty = wrist.y + dy * along;
        m.palm = m.palm ? { x: lerp(m.palm.x, palm.x, 0.45), y: lerp(m.palm.y, palm.y, 0.45) } : palm;
        m.source = 'hand';
      } else if (drag) {
        tx = drag.x;
        ty = drag.y;
        tAngle = 0;
        tHalfH = (face ? face.halfWidth * 1.15 : lastSize) * size;
        m.source = 'drag';
        m.palm = null;
      } else if (face) {
        tx = face.x;
        ty = H - face.y;
        tAngle = 0;
        tHalfH = face.halfWidth * 1.15 * size;
        m.source = 'face';
        m.palm = null;
      } else if (!m.ready) {
        return m; // nothing to place it on yet
      } else {
        tx = m.x;
        ty = m.y;
        tAngle = 0;
        tHalfH = m.hh;
      }
      lastSize = tHalfH / size;

      // Smooth: the mirror should glide, not jitter.
      const k = m.ready ? 0.45 : 1;
      m.x = lerp(m.x, tx, k);
      m.y = lerp(m.y, ty, k);
      m.angle = lerpAngle(m.angle, tAngle, k);
      m.hh = lerp(m.hh, tHalfH, k);
      m.hw = circle ? m.hh : m.hh * 0.72; // circle, or a portrait pane like a hand mirror
      if (circle) m.angle = 0;
      if (m.source === 'hand') drag = { x: m.x, y: m.y }; // put it down where the hand left it
      m.ready = true;
      return m;
    },

    /** Is a point (un-mirrored, top-left origin) inside the mirror? For hiding labels. */
    contains(x, yTop, H) {
      if (!m.ready) return false;
      const px = x - m.x, py = H - yTop - m.y;
      if (m.shape === 'circle') return Math.hypot(px, py) < m.hh;
      const c = Math.cos(m.angle), s = Math.sin(m.angle);
      const lx = c * px + s * py, ly = -s * px + c * py;
      return Math.abs(lx) < m.hw && Math.abs(ly) < m.hh;
    },
  };
}

/**
 * Glass tint inside the mirror. Drawn on the 2D canvas UNDER the x-ray glow
 * (that canvas is mirrored by CSS, so we draw in un-mirrored coordinates).
 */
export function drawMirrorGlass(canvas, m) {
  if (!m.ready || m.shape === 'circle') return; // the circle has no glass, like the original
  const ctx = canvas.getContext('2d');
  const H = canvas.height;
  ctx.save();
  ctx.translate(m.x, H - m.y);
  ctx.rotate(-m.angle); // y-down canvas: opposite turn direction
  roundRect(ctx, -m.hw, -m.hh, m.hw * 2, m.hh * 2, Math.min(m.hw, m.hh) * 0.18);
  const g = ctx.createLinearGradient(0, -m.hh, 0, m.hh);
  g.addColorStop(0, 'rgba(8, 18, 40, 0.50)');
  g.addColorStop(1, 'rgba(4, 10, 26, 0.62)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/**
 * Mirror frame, glass shine and a small label. Drawn on the TOP canvas (not mirrored),
 * so x is flipped here and the rotation turns the other way.
 */
export function drawMirrorFrame(canvas, m) {
  if (!m.ready) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  if (m.shape === 'circle') {
    // Just a thin, faint white circle, like the original video.
    ctx.save();
    ctx.strokeStyle = 'rgba(235, 242, 255, 0.55)';
    ctx.lineWidth = Math.max(1.2, H / 520);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(W - m.x, H - m.y, m.hh, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const r = Math.min(m.hw, m.hh) * 0.18;
  const lw = Math.max(2, m.hh * 0.025);

  // Handle (only when held): from the bottom-middle of the glass down into your palm.
  if (m.source === 'hand' && m.palm) {
    const cx = W - m.x, cy = H - m.y;
    const bx = cx - Math.sin(m.angle) * m.hh, by = cy + Math.cos(m.angle) * m.hh;
    const px = W - m.palm.x, py = H - m.palm.y;
    const handle = ctx.createLinearGradient(bx, by, px, py);
    handle.addColorStop(0, 'rgba(225, 235, 250, 0.85)');
    handle.addColorStop(1, 'rgba(150, 170, 200, 0.25)');
    ctx.save();
    ctx.strokeStyle = handle;
    ctx.lineCap = 'round';
    ctx.lineWidth = m.hw * 0.2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(W - m.x, H - m.y);
  ctx.rotate(m.angle);

  // Outer frame with a metallic gradient + soft blue glow.
  roundRect(ctx, -m.hw, -m.hh, m.hw * 2, m.hh * 2, r);
  const metal = ctx.createLinearGradient(-m.hw, -m.hh, m.hw, m.hh);
  metal.addColorStop(0, 'rgba(235, 242, 255, 0.95)');
  metal.addColorStop(0.5, 'rgba(140, 160, 190, 0.85)');
  metal.addColorStop(1, 'rgba(225, 235, 250, 0.95)');
  ctx.shadowColor = 'rgba(90, 150, 255, 0.8)';
  ctx.shadowBlur = lw * 5;
  ctx.strokeStyle = metal;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Thin inner line.
  roundRect(ctx, -m.hw + lw * 1.6, -m.hh + lw * 1.6, (m.hw - lw * 1.6) * 2, (m.hh - lw * 1.6) * 2, r * 0.8);
  ctx.strokeStyle = 'rgba(200, 225, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Glass shine: a soft diagonal streak, clipped to the glass.
  ctx.save();
  roundRect(ctx, -m.hw, -m.hh, m.hw * 2, m.hh * 2, r);
  ctx.clip();
  const shine = ctx.createLinearGradient(-m.hw, -m.hh, m.hw * 0.2, m.hh * 0.2);
  shine.addColorStop(0, 'rgba(255,255,255,0.0)');
  shine.addColorStop(0.42, 'rgba(255,255,255,0.0)');
  shine.addColorStop(0.5, 'rgba(255,255,255,0.10)');
  shine.addColorStop(0.58, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = shine;
  ctx.fillRect(-m.hw, -m.hh, m.hw * 2, m.hh * 2);
  ctx.restore();

  // Little "X-RAY" tag at the top of the glass.
  const fs = Math.max(10, m.hh * 0.07);
  ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(190, 220, 255, 0.75)';
  ctx.fillText('X-RAY', 0, -m.hh + lw * 2.5);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
