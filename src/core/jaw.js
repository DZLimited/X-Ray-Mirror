// Drives the lower jaw from MediaPipe's "jawOpen" expression score.
//
// A real jaw doesn't only swing like a door hinge: when you open wide, the condyles
// (the jaw's ball joints in front of your ears) also slide forward and a little down.
// We copy that: rotate around the hinge AND shift the hinge forward as the mouth opens.
import headMeta from './headMeta.json';

const DEG = Math.PI / 180;
const REST = 0.04; // jawOpen reads ~0.0-0.05 with a closed mouth
const FULL = 0.6; // jawOpen rarely goes far above ~0.6-0.7, even when wide open
const GLIDE_FORWARD = 0.7; // cm the condyles slide forward at full opening
const GLIDE_DOWN = 0.25; // cm they move down

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function createJawDriver() {
  let value = 0; // smoothed 0..1 opening
  const pivot = headMeta.jawPivot;

  return {
    /**
     * jawOpen: MediaPipe blendshape (0..1), or null if no face
     * opts: { jawGain, jawMaxDeg, jawTest }  (jawTest > 0 = manual opening, for testing)
     * Returns the opening used (0..1), so the UI can show it.
     */
    update(jawGroup, jawOpen, opts) {
      let target;
      if (opts.jawTest > 0) target = opts.jawTest;
      else if (jawOpen == null) target = 0;
      else target = clamp01(((jawOpen - REST) / (FULL - REST)) * (opts.jawGain ?? 1));

      // Light smoothing of its own: quick enough for talking, removes flicker.
      value += (target - value) * 0.55;

      if (jawGroup) {
        // +x rotation in head space swings the chin down and back = opening.
        jawGroup.rotation.x = value * (opts.jawMaxDeg ?? 26) * DEG;
        jawGroup.position.set(
          pivot[0],
          pivot[1] - value * GLIDE_DOWN,
          pivot[2] + value * GLIDE_FORWARD
        );
      }
      return value;
    },
  };
}
