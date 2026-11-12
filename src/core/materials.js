// Custom shaders for the anatomy.
//
//  X-ray: each surface glows at its outline (seen side-on) and adds a faint fill, as light
//         added on top of the video, ignoring depth. Per-layer colour, rim strength, fill and
//         rim sharpness give the look from the original video: white-blue skull, pink-purple
//         brain, purple eyes, red muscles, a strong blue head outline.
//  Solid: lit surfaces with normal depth.
//
//  Reveal: what part of the anatomy is shown.
//    0 whole head | 1 left half (screen) | 2 right half (screen) | 3 top of head | 4 lower face
//    5 lens (a soft circle on screen)
//    6 mirror (a handheld glass pane on screen: rotated rounded rectangle)
//  Cuts happen in HEAD space (cm), so they follow your head; edges are feathered.
//
//  Dimmer: an extra pass with the head-outline mesh that darkens the video inside your head
//  silhouette (soft at the edges), so the glow reads like the original.
import * as THREE from 'three';

export const REVEAL = { head: 0, left: 1, right: 2, top: 3, lower: 4, lens: 5, mirror: 6 };

/** Uniforms shared by every anatomy material (updated once per frame). */
export function createSharedUniforms() {
  return {
    uReveal: { value: 0 },
    uCut: { value: 0 }, // cm in head space (meaning depends on the reveal mode)
    uCutFeather: { value: 1.5 }, // cm
    uHeadInv: { value: new THREE.Matrix4() }, // world -> head space
    uLensCenter: { value: new THREE.Vector2() }, // drawing-buffer pixels, origin bottom-left
    uLensRadius: { value: 300 },
    uLensFeather: { value: 0.2 },
    uMirrorCenter: { value: new THREE.Vector2() }, // drawing-buffer pixels, origin bottom-left
    uMirrorHalf: { value: new THREE.Vector2(100, 140) },
    uMirrorAngle: { value: 0 },
    uMirrorRadius: { value: 20 },
    uMirrorFeather: { value: 2 }, // soft edge, in pixels
    uBrightness: { value: 1 },
    uOpacity: { value: 1 },
    uEdgeFeather: { value: 0.17 },
    uDim: { value: 0.5 },
  };
}

const vertexShader = /* glsl */ `
  uniform mat4 uHeadInv;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec3 vHeadPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeadPos = (uHeadInv * world).xyz;
    vec4 mv = viewMatrix * world;
    vViewPos = mv.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

// Shared GLSL: how much of this fragment the reveal mode lets through (0..1).
const revealGlsl = /* glsl */ `
  uniform float uReveal;
  uniform float uCut;
  uniform float uCutFeather;
  uniform vec2 uLensCenter;
  uniform float uLensRadius;
  uniform float uLensFeather;
  uniform vec2 uMirrorCenter;
  uniform vec2 uMirrorHalf;
  uniform float uMirrorAngle;
  uniform float uMirrorRadius;
  uniform float uMirrorFeather;
  varying vec3 vHeadPos;

  float revealMask() {
    float f = max(uCutFeather, 0.01);
    if (uReveal < 0.5) return 1.0;
    // Head space: +x = your left = the LEFT of the mirrored screen.
    if (uReveal < 1.5) return smoothstep(uCut - f, uCut + f, vHeadPos.x);        // left half
    if (uReveal < 2.5) return 1.0 - smoothstep(uCut - f, uCut + f, vHeadPos.x);  // right half
    if (uReveal < 3.5) return smoothstep(uCut - f, uCut + f, vHeadPos.y);        // top of head
    if (uReveal < 4.5) return 1.0 - smoothstep(uCut - f, uCut + f, vHeadPos.y);  // lower face
    if (uReveal < 5.5) {                                                         // lens
      float d = distance(gl_FragCoord.xy, uLensCenter);
      return 1.0 - smoothstep(uLensRadius * (1.0 - uLensFeather), uLensRadius, d);
    }
    // Mirror: rotate into the pane's own axes, then a rounded-rectangle distance.
    vec2 p = gl_FragCoord.xy - uMirrorCenter;
    float c = cos(uMirrorAngle), s = sin(uMirrorAngle);
    p = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
    vec2 q = abs(p) - uMirrorHalf + uMirrorRadius;
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uMirrorRadius;
    return 1.0 - smoothstep(-uMirrorFeather, 1.0, dist);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uXrayColor;
  uniform vec3 uSolidColor;
  uniform float uRim;       // x-ray: outline strength
  uniform float uRimPow;    // x-ray: outline sharpness (higher = thinner)
  uniform float uFill;      // x-ray: faint fill
  uniform float uMode;      // 1 = x-ray, 0 = solid
  uniform float uLayerAlpha;
  uniform float uOpacity;
  uniform float uBrightness;
  uniform float uEdgeFeather;
  uniform float uNeckFade;  // 1 = fade out down the neck (head outline: its cut edge would glow)
  varying vec3 vNormal;
  varying vec3 vViewPos;
  ${revealGlsl}

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(-vViewPos);
    float facing = clamp(dot(n, v), 0.0, 1.0);

    float mask = revealMask() * uOpacity;
    mask *= mix(1.0, smoothstep(-11.5, -8.0, vHeadPos.y), uNeckFade);
    if (mask < 0.004) discard;

    if (uMode > 0.5) {
      float rim = pow(1.0 - facing, uRimPow);
      vec3 color = uXrayColor * (rim * uRim + uFill) * uBrightness * mask;
      // Pure light: add colour, keep canvas transparency so the video stays visible.
      gl_FragColor = vec4(color, 0.0);
    } else {
      vec3 L = normalize(vec3(0.35, 0.55, 1.0));
      float diff = max(dot(n, L), 0.0);
      float sky = 0.5 + 0.5 * n.y;
      vec3 h = normalize(L + v);
      float spec = pow(max(dot(n, h), 0.0), 40.0) * 0.18;
      vec3 color = uSolidColor * (0.22 + 0.3 * sky + 0.7 * diff) * uBrightness + spec;
      float alpha = uLayerAlpha * smoothstep(0.0, max(uEdgeFeather, 0.001), facing) * mask;
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(color, alpha);
    }
  }
`;

// Darkens the video inside the head silhouette (x-ray look only).
const dimFragmentShader = /* glsl */ `
  uniform float uDim;
  uniform float uOpacity;
  uniform float uEdgeFeather;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  ${revealGlsl}
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float facing = clamp(dot(n, normalize(-vViewPos)), 0.0, 1.0);
    // Strong in the middle of the face, fading to nothing at the silhouette.
    float a = uDim * uOpacity * revealMask() * smoothstep(0.0, 0.25 + uEdgeFeather, facing);
    a *= smoothstep(-12.5, -7.5, vHeadPos.y); // fade out down the neck
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;

/**
 * One material per layer.
 * look: { xray, solid, layerAlpha, rim, rimPow, fill }
 */
export function createAnatomyMaterial(shared, look) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...shared, // same objects -> one update reaches every material
      uXrayColor: { value: new THREE.Color(look.xray) },
      uSolidColor: { value: new THREE.Color(look.solid) },
      uRim: { value: look.rim ?? 0.32 },
      uRimPow: { value: look.rimPow ?? 2.5 },
      uFill: { value: look.fill ?? 0.012 },
      uMode: { value: 1 },
      uLayerAlpha: { value: look.layerAlpha ?? 1 },
      uNeckFade: { value: look.neckFade ? 1 : 0 },
    },
    transparent: true,
  });
}

/** Dimmer material (drawn with the head-outline mesh before the glowing layers). */
export function createDimMaterial(shared) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: dimFragmentShader,
    uniforms: { ...shared },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide, // one layer of darkening, not two
  });
}

/** Switch a material between the two looks. Only touches GL state when it changes. */
export function setMaterialLook(mat, look) {
  const xray = look === 'xray';
  mat.uniforms.uMode.value = xray ? 1 : 0;
  const blending = xray ? THREE.CustomBlending : THREE.NormalBlending;
  if (mat.blending !== blending) {
    mat.blending = blending;
    if (xray) {
      // colour: src + dst (add light). alpha: keep dst (stays transparent).
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneFactor;
      mat.blendEquationAlpha = THREE.AddEquation;
      mat.blendSrcAlpha = THREE.ZeroFactor;
      mat.blendDstAlpha = THREE.OneFactor;
    }
    mat.depthTest = !xray; // x-ray: see everything at once
    mat.depthWrite = !xray;
    mat.side = xray ? THREE.DoubleSide : THREE.FrontSide;
    mat.needsUpdate = true;
  }
}
