// Adaptive smoothing (the idea behind the "One-Euro filter"):
//   holding still -> heavy smoothing (no jitter)
//   moving fast   -> almost no smoothing (no lag)
// `speed` is how far the new measurement is from the current smoothed value, `fast` is the
// speed that counts as "moving fast". `smoothing` is the user's slider (0..0.9).
// Returns the blend factor for lerp/slerp: 0 = keep old, 1 = jump to new.
export function adaptiveAlpha(speed, fast, smoothing = 0.5) {
  const still = 1 - Math.min(0.92, 0.45 + smoothing * 0.5); // smoothing 0.5 -> 0.30 when still
  const t = Math.min(1, Math.max(0, speed / fast));
  return still + (1 - still) * t * t * (3 - 2 * t); // smooth ramp between still and fast
}
