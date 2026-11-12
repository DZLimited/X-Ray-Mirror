# BodyParts3D right-hand bones -> per-bone local frames that match MediaPipe's 21 hand landmarks.
#
# MediaPipe hand landmarks:
#   0 wrist | thumb 1 CMC, 2 MCP, 3 IP, 4 tip | index 5 MCP, 6 PIP, 7 DIP, 8 tip
#   middle 9-12 | ring 13-16 | little 17-20
#
# Each finger bone sits between two landmarks (a -> b). We store the bone's mesh in a local frame:
#   origin = joint a, +Y = towards joint b, +Z = "dorsal-ish" (perpendicular to Y and to the palm's
#   side-to-side axis), unit = cm. At runtime the app builds the same frame from your tracked
#   joints, scales by (your bone length / model bone length), and the bone lands in place.
# The wrist bones + metacarpals 2-5 move together in one "palm" frame.
import json, trimesh, numpy as np, fast_simplification as fs

D = '/tmp/bp3d/repo/assets/BodyParts3D_data/stl'
G = json.load(open('groups.json')); n = G['names']
ids = {n[x]: x for x in G['groups']['handRight']}
load = lambda name: trimesh.load(f'{D}/{ids["right " + name] if "right " + name in ids else ids[name]}.stl')

def mm2cm(v): return np.asarray(v, float) / 10.0

FINGERS = ['index finger', 'middle finger', 'ring finger', 'little finger']
MC = {'index finger': 'second metacarpal bone', 'middle finger': 'third metacarpal bone',
      'ring finger': 'fourth metacarpal bone', 'little finger': 'fifth metacarpal bone'}
CARPALS = ['trapezoid', 'scaphoid', 'lunate', 'triquetral', 'pisiform', 'trapezium', 'capitate', 'hamate']

meshes = {}
def get(name):
    if name not in meshes:
        m = load(name); meshes[name] = trimesh.Trimesh(mm2cm(m.vertices), m.faces, process=True)
    return meshes[name]

carpal_center = np.mean([get(c).centroid for c in CARPALS], axis=0)

def ends(name):
    """Proximal and distal end points of a long bone (along its main axis)."""
    v = get(name).vertices; c = v.mean(0)
    axis = np.linalg.svd(v - c, full_matrices=False)[2][0]
    t = (v - c) @ axis
    a, b = c + axis * np.percentile(t, 1.5), c + axis * np.percentile(t, 98.5)
    return (a, b) if np.linalg.norm(a - carpal_center) < np.linalg.norm(b - carpal_center) else (b, a)

# --- joint positions on the model, numbered like MediaPipe ---
J = {}
mc1p, mc1d = ends('first metacarpal bone')
tp_p, tp_d = ends('proximal phalanx of right thumb')
td_p, td_d = ends('distal phalanx of right thumb')
J[1] = mc1p; J[2] = (mc1d + tp_p) / 2; J[3] = (tp_d + td_p) / 2; J[4] = td_d
for k, f in enumerate(FINGERS):
    base = 5 + 4 * k
    mp, md = ends(MC[f])
    pp, pd = ends(f'proximal phalanx of right {f}')
    mip, mid_ = ends(f'middle phalanx of right {f}')
    dp, dd = ends(f'distal phalanx of right {f}')
    J[base] = (md + pp) / 2; J[base + 1] = (pd + mip) / 2; J[base + 2] = (mid_ + dp) / 2; J[base + 3] = dd
# Wrist landmark sits at the wrist crease, ~1.2 cm before the carpal centre.
to_mcp = J[9] - carpal_center; to_mcp /= np.linalg.norm(to_mcp)
J[0] = carpal_center - to_mcp * 1.2

def palm_axes(P):
    """Palm frame from joints: Y wrist->middle MCP, Xs little MCP->index MCP, Z = Xs x Y."""
    y = P[9] - P[0]; y /= np.linalg.norm(y)
    xs = P[5] - P[17]; xs -= y * (xs @ y); xs /= np.linalg.norm(xs)
    z = np.cross(xs, y); z /= np.linalg.norm(z)
    return xs, y, z

def bone_frame(a, b, palm_x):
    y = b - a; L = np.linalg.norm(y); y /= L
    z = np.cross(palm_x, y); z /= np.linalg.norm(z)
    x = np.cross(y, z)
    return np.stack([x, y, z], 1), L      # columns = axes

def to_local(v, origin, R, scale=1.0): return ((v - origin) @ R) / scale

PX, PY, PZ = palm_axes(J)
palm_R = np.stack([PX, PY, PZ], 1); palm_len = np.linalg.norm(J[9] - J[0])

SEGMENTS = {  # bone key -> (landmark a, landmark b, model bone name)
    'thumb_mc': (1, 2, 'first metacarpal bone'),
    'thumb_prox': (2, 3, 'proximal phalanx of right thumb'),
    'thumb_dist': (3, 4, 'distal phalanx of right thumb'),
}
for k, f in enumerate(FINGERS):
    key = f.split()[0]; base = 5 + 4 * k
    SEGMENTS[f'{key}_prox'] = (base, base + 1, f'proximal phalanx of right {f}')
    SEGMENTS[f'{key}_mid'] = (base + 1, base + 2, f'middle phalanx of right {f}')
    SEGMENTS[f'{key}_dist'] = (base + 2, base + 3, f'distal phalanx of right {f}')

def simplify(m, keep):
    v, f = m.vertices.astype(np.float32), m.faces
    if keep < 0.98: v, f = fs.simplify(v, f, target_reduction=1 - keep)
    return trimesh.Trimesh(v, f, process=True)

KEEP = 0.45
scene = trimesh.Scene(); meta = {'segments': {}, 'palm': {'a': 0, 'b': 9, 'restLength': float(palm_len)}}
# palm: carpals + metacarpals 2-5, in the palm frame, normalised by palm length
for name in CARPALS + [MC[f] for f in FINGERS]:
    m = get(name); mm = simplify(m, KEEP)
    mm.vertices = to_local(mm.vertices, J[0], palm_R)
    scene.add_geometry(mm, node_name=f'palm|{name}', geom_name=f'palm|{name}')
for key, (a, b, name) in SEGMENTS.items():
    R, L = bone_frame(J[a], J[b], PX)
    mm = simplify(get(name), KEEP)
    mm.vertices = to_local(mm.vertices, J[a], R)
    scene.add_geometry(mm, node_name=f'{key}|{name}', geom_name=f'{key}|{name}')
    meta['segments'][key] = {'a': a, 'b': b, 'restLength': float(L)}

scene.export('hand_raw.glb', include_normals=True)
meta['joints'] = {k: np.round(v, 3).tolist() for k, v in J.items()}
json.dump(meta, open('hand_meta.json', 'w'), indent=1)
tri = sum(len(g.faces) for g in scene.geometry.values())
print('bones', len(scene.geometry), 'triangles', tri, 'palm length cm', round(palm_len, 2))
for k, s in meta['segments'].items(): print(f"  {k:12s} {s['a']:2d}->{s['b']:2d}  {s['restLength']:.2f} cm")
