// Anatomy labels with leader lines, drawn on a canvas that is NOT mirrored (so text reads
// normally). Anchor positions come in un-mirrored video pixels; we mirror x ourselves.
//
// Layout: head labels go into two columns beside the head (left/right of its centre),
// sorted by height and pushed apart so they never overlap. Hand labels sit beside the hand.

export function syncLabelCanvas(canvas, w, h) {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.getContext('2d').clearRect(0, 0, w, h);
}

/**
 * labels: [{ text, x, y, hand? }]   (video pixels, un-mirrored)
 * headBox: { x, y, halfWidth } or null
 */
export function drawLabels(canvas, labels, headBox) {
  if (!labels.length) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const font = Math.max(11, Math.round(H * 0.018));
  const gap = font * 1.5;
  const margin = font;
  ctx.font = `${font}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';

  // Mirror x so it matches the mirrored video.
  const items = labels.map((l) => ({ ...l, ax: W - l.x, ay: l.y, w: ctx.measureText(l.text).width }));

  // ONE layout for everything (head, body, hands): each label goes to the left or right of the
  // head's centre, and each side is a single stack, so labels can never overlap each other.
  const hx = headBox ? W - headBox.x : W / 2;
  const colOffset = headBox ? headBox.halfWidth * 1.25 + font * 1.5 : W * 0.2;
  const sides = { left: [], right: [] };
  for (const it of items) {
    const side = it.ax < hx ? 'left' : 'right';
    it.col = side;
    sides[side].push(it);
  }
  // Each side is one straight column OUTSIDE everything it points at (head, body, hands),
  // like the original video, so the text never sits on top of the bones.
  const colX = {
    left: Math.min(hx - colOffset, ...sides.left.map((it) => it.ax - font * 2.5)),
    right: Math.max(hx + colOffset, ...sides.right.map((it) => it.ax + font * 2.5)),
  };
  for (const it of items) it.colX = colX[it.col];

  const shown = [];
  for (const [name, col] of Object.entries(sides)) {
    if (!col.length) continue;
    col.sort((a, b) => a.ay - b.ay);
    // Crowded side: tighten the spacing; if it still doesn't fit, drop the extras evenly.
    let g = Math.max(font * 1.12, Math.min(gap, (H - 2 * margin) / col.length));
    const fit = Math.floor((H - 2 * margin) / g) + 1;
    let list = col;
    if (col.length > fit) {
      // Keep `fit` labels spread evenly from top to bottom.
      const step = col.length / fit;
      list = Array.from({ length: fit }, (_, i) => col[Math.floor(i * step)]);
    }
    let y = -Infinity;
    for (const it of list) {
      it.ly = Math.max(it.ay, y + g);
      y = it.ly;
    }
    const overflow = list[list.length - 1].ly - (H - margin);
    if (overflow > 0) for (const it of list) it.ly -= overflow;
    let top = margin;
    for (const it of list) {
      it.ly = Math.max(it.ly, top);
      top = it.ly + g;
    }
    for (const it of list) {
      if (name === 'left') it.colX = Math.max(it.colX, it.w + margin);
      else it.colX = Math.min(it.colX, W - it.w - margin);
      shown.push(it);
    }
  }

  // Draw: line anchor -> elbow -> text, a dot on the anchor, then the text.
  for (const it of shown) {
    const leftSide = it.col === 'left';
    const textX = leftSide ? it.colX - 4 : it.colX + 4;
    const elbowX = leftSide ? it.colX + font * 0.8 : it.colX - font * 0.8;

    ctx.strokeStyle = 'rgba(214, 232, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(it.ax, it.ay);
    ctx.lineTo(elbowX, it.ly);
    ctx.lineTo(it.colX, it.ly);
    ctx.stroke();

    ctx.fillStyle = 'rgba(214, 232, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(it.ax, it.ay, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = leftSide ? 'right' : 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = 'rgba(240, 246, 252, 0.95)';
    ctx.fillText(it.text, textX, it.ly);
    ctx.shadowBlur = 0;
  }
}

/** The faint circle that shows where the x-ray lens is (like the original). */
export function drawLensCircle(canvas, lens) {
  const ctx = canvas.getContext('2d');
  const x = canvas.width - lens.x; // mirror to match the video
  ctx.save();
  ctx.strokeStyle = 'rgba(230, 240, 255, 0.35)';
  ctx.lineWidth = Math.max(1, canvas.height / 600);
  ctx.beginPath();
  ctx.arc(x, lens.y, lens.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
