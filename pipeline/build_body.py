# Upper-body skeleton (BodyParts3D) -> body.glb + body_meta.json, matched to MediaPipe Pose.
#
# MediaPipe Pose points we use: 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips
# (odd = the person's LEFT side).
#
# Groups and how the app moves them:
#   torso   ribs, costal cartilage, sternum, thoracic spine, clavicles, scapulae.
#           One rigid "torso frame": origin = between the shoulders, X = right->left shoulder,
#           Y = up (from between the hips to between the shoulders), Z = forward.
#   arms    humerus: shoulder -> elbow; radius + ulna: elbow -> wrist (like the finger bones).
#   neck    C1..C7, stored in HEAD space. The app blends each one between "attached to the head"
#           and "attached to the torso" (C1 = all head, C7 = all torso), so the neck bends smoothly.
import json, trimesh, numpy as np, fast_simplification as fs

D = '/tmp/bp3d/repo/assets/BodyParts3D_data/stl'
B = json.load(open('body_parts.json')); G = B['groups']; N = B['names']
names = {v: k for k, v in N.items()}

def load_cm(fid):
    m = trimesh.load(f'{D}/{fid}.stl')
    return trimesh.Trimesh(np.asarray(m.vertices) / 10.0, m.faces, process=True)   # BP: cm, x=left, y=back, z=up

# Thoracic set in the composite list stops at T8; add T9-T12 by name.
extra = {'ninth thoracic vertebra': 'FMA10014', 'tenth thoracic vertebra': 'FMA10037',
         'eleventh thoracic vertebra': 'FMA10059', 'twelfth thoracic vertebra': 'FMA10081'}
for n, fid in extra.items():
    if fid not in G['thoracic']: G['thoracic'].append(fid); N[fid] = n

M = {g: [(fid, load_cm(fid)) for fid in ids] for g, ids in G.items()}
one = lambda g: M[g][0][1]

# ---------- joints (BP space, cm) ----------
def top_center(m, depth, medial_side=None):
    v = m.vertices; zt = v[:, 2].max()
    sel = v[v[:, 2] > zt - depth]
    if medial_side is not None:          # keep the half nearer the body's midline (femoral head, humeral head)
        med = np.abs(sel[:, 0]) < np.median(np.abs(sel[:, 0]))
        sel = sel[med]
    return sel.mean(0)
def bottom_center(verts, depth):
    zb = verts[:, 2].min(); return verts[verts[:, 2] < zb + depth].mean(0)

J = {}
for side, s in (('L', 'L'), ('R', 'R')):
    hum = one('humerus' + s)
    J['shoulder' + s] = top_center(hum, 3.0, medial_side=True)
    J['elbow' + s] = bottom_center(hum.vertices, 2.0)
    fore = np.vstack([one('radius' + s).vertices, one('ulna' + s).vertices])
    J['wrist' + s] = bottom_center(fore, 1.5)
    J['hip' + s] = top_center(one('femur' + s), 3.0, medial_side=True)

S = (J['shoulderL'] + J['shoulderR']) / 2
Hm = (J['hipL'] + J['hipR']) / 2
X = J['shoulderL'] - J['shoulderR']; shoulder_w = np.linalg.norm(X); X /= shoulder_w
Y = S - Hm; Y -= X * (Y @ X); torso_len = np.linalg.norm(S - Hm); Y /= np.linalg.norm(Y)
Z = np.cross(X, Y)
R_torso = np.stack([X, Y, Z], 1)
print('shoulder width', round(shoulder_w, 1), 'cm, shoulder->hip', round(torso_len, 1), 'cm, forward', np.round(Z, 2))

def simplify(m, keep):
    v, f = m.vertices.astype(np.float32), m.faces
    if keep < 0.98: v, f = fs.simplify(v, f, target_reduction=1 - keep)
    return trimesh.Trimesh(v, f, process=True)

def seg_frame(a, b):
    y = b - a; L = np.linalg.norm(y); y /= L
    z = Z - y * (Z @ y)                   # forward, made perpendicular to the bone
    if np.linalg.norm(z) < 1e-3: z = Y - y * (Y @ y)
    z /= np.linalg.norm(z); x = np.cross(y, z)
    return np.stack([x, y, z], 1), L

scene = trimesh.Scene()
meta = {'torso': {'restWidth': float(shoulder_w), 'restLength': float(torso_len)}, 'segments': {}, 'neck': [], 'labels': []}

# torso
TORSO = ['thoracic', 'ribs', 'sternum', 'clavicleR', 'clavicleL', 'scapulaR', 'scapulaL']
# Triangle budget per group (the source meshes are very dense).
BUDGET = {'thoracic': 9000, 'ribs': 16000, 'sternum': 2500, 'clavicleR': 1500, 'clavicleL': 1500, 'scapulaR': 3000, 'scapulaL': 3000}
KEEP = {g: min(1.0, b / sum(len(m.faces) for _, m in M[g])) for g, b in BUDGET.items()}
tri = 0
torso_local = lambda v: (v - S) @ R_torso
for g in TORSO:
    for fid, m in M[g]:
        mm = simplify(m, KEEP[g]); mm.vertices = torso_local(mm.vertices); tri += len(mm.faces)
        scene.add_geometry(mm, node_name=f'torso|{N[fid]}', geom_name=f'torso|{N[fid]}')

# arms
for s, side in (('L', 'left'), ('R', 'right')):
    for key, a, b, groups in ((f'humerus{s}', f'shoulder{s}', f'elbow{s}', [f'humerus{s}']),
                              (f'forearm{s}', f'elbow{s}', f'wrist{s}', [f'radius{s}', f'ulna{s}'])):
        R, L = seg_frame(J[a], J[b])
        for g in groups:
            fid, m = M[g][0]
            mm = simplify(m, min(1.0, 2500 / len(m.faces))); mm.vertices = (mm.vertices - J[a]) @ R; tri += len(mm.faces)
            scene.add_geometry(mm, node_name=f'{key}|{N[fid]}', geom_name=f'{key}|{N[fid]}')
        meta['segments'][key] = {'a': a, 'b': b, 'restLength': float(L)}

# neck: head space via the same transform as head.glb, plus the fixed head-space -> torso-local map
A = json.load(open('align_icp.json'))
bp_eye_mid = np.array(A['bp_eye_mid']); R0 = np.array(A['R0']); c_eye_mid = np.array(A['c_eye_mid'])
Rf = np.array(A['R']); sf = A['s']; tf = np.array(A['t'])
def to_head_cm(v_cm):   # BP cm -> head space (same as build_head.py, which works on mm)
    v = np.asarray(v_cm) * 10.0
    h = np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1) / 10
    t0 = (R0 @ (h - bp_eye_mid).T).T + c_eye_mid
    return sf * (Rf @ (t0 - tf).T).T
P = np.random.default_rng(0).normal(size=(50, 3)) * 20 + S
Hh = np.c_[to_head_cm(P), np.ones(len(P))]; Tt = torso_local(P)
M_ht = np.linalg.lstsq(Hh, Tt, rcond=None)[0].T          # 3x4: head space -> torso local
print('head->torso map error (cm)', float(np.abs(Hh @ M_ht.T - Tt).max()))
meta['headToTorso'] = np.vstack([M_ht, [0, 0, 0, 1]]).T.flatten().tolist()   # column-major for three.js
neck = [k for k in G if k.startswith('cervical|')]
for i, k in enumerate(neck):
    fid, m = M[k][0]
    mm = simplify(m, min(1.0, 900 / len(m.faces))); mm.vertices = to_head_cm(mm.vertices); tri += len(mm.faces)
    scene.add_geometry(mm, node_name=f'neck{i}|{N[fid]}', geom_name=f'neck{i}|{N[fid]}')
    meta['neck'].append({'key': f'neck{i}', 'name': N[fid], 'blend': i / (len(neck) - 1)})

# labels: an outer point of each structure, in its group's local frame
def outer_point(v, away_from):
    c = v.mean(0); d = c - away_from; d /= np.linalg.norm(d) + 1e-9
    rel = v - c; return v[np.argmax(rel @ d)]
centre_chest = S - Y * torso_len * 0.3
LABELS = [('Clavicle', 'torso', 'clavicleL'), ('Scapula', 'torso', 'scapulaR'), ('Sternum', 'torso', 'sternum'),
          ('Ribs', 'torso', 'ribs'), ('Thoracic vertebrae', 'torso', 'thoracic'),
          ('Humerus', 'humerusL', 'humerusL'), ('Radius', 'forearmL', 'radiusL'), ('Ulna', 'forearmR', 'ulnaR')]
for text, key, g in LABELS:
    v = np.vstack([m.vertices for _, m in M[g]])
    if g == 'thoracic': p = v[v[:, 2] > np.percentile(v[:, 2], 60)].mean(0)       # upper back, middle
    elif g == 'ribs':                                                                # right side, mid-height
        r = v[v[:, 0] < 0]; zm = np.percentile(r[:, 2], 45)
        band = r[np.abs(r[:, 2] - zm) < 1.5]; p = band[np.argmin(band[:, 0])]
    else: p = outer_point(v, centre_chest)
    if key == 'torso': local = torso_local(p[None])[0]
    else:
        seg = meta['segments'][key]; R, _ = seg_frame(J[seg['a']], J[seg['b']]); local = (p - J[seg['a']]) @ R
    meta['labels'].append({'text': text, 'group': key, 'point': np.round(local, 3).tolist()})
cv = np.vstack([M[k][0][1].vertices for k in neck])
meta['labels'].append({'text': 'Cervical vertebrae', 'group': 'neck3', 'head': np.round(to_head_cm(cv.mean(0)[None])[0] + [0, 0, -1.5], 3).tolist()})

scene.export('body_raw.glb', include_normals=True)
meta['joints'] = {k: np.round(v, 2).tolist() for k, v in J.items()}
json.dump(meta, open('body_meta.json', 'w'), indent=1)
print('triangles', tri, '| segments', {k: round(v['restLength'], 1) for k, v in meta['segments'].items()})
