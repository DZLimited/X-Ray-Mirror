# Label anchor points for the head (head space, cm, before fit).
# For each label we take its part(s) and find a point on their OUTER surface:
# the vertex furthest out from the head centre, near the line through the parts' centre.
# "left ..." parts appear on the left of the (mirrored) screen, "right ..." on the right.
import json, trimesh, numpy as np

LABELS = [
    # text, layer, [parts]
    ('Frontal bone', 'skull', ['cranium|frontal bone']),
    ('Parietal bone', 'skull', ['cranium|left parietal bone']),
    ('Temporal bone', 'skull', ['cranium|right temporal bone']),
    ('Occipital bone', 'skull', ['cranium|occipital bone']),
    ('Zygomatic bone (cheekbone)', 'skull', ['cranium|left zygomatic bone']),
    ('Maxilla (upper jaw)', 'skull', ['cranium|right maxilla']),
    ('Nasal bone', 'skull', ['cranium|right nasal bone', 'cranium|left nasal bone']),
    ('Mandible (lower jaw)', 'skull', ['jaw|mandible']),
    ('Teeth', 'skull', ['cranium|left upper central secondary incisor tooth', 'cranium|left upper lateral secondary incisor tooth']),
    ('Frontal lobe', 'brain', ['brain|right superior frontal gyrus', 'brain|right middle frontal gyrus']),
    ('Parietal lobe', 'brain', ['brain|left superior parietal lobule precuneus', 'brain|left supramarginal gyrus', 'brain|left angular gyrus']),
    ('Temporal lobe', 'brain', ['brain|right middle temporal gyrus', 'brain|right inferior temporal gyrus']),
    ('Occipital lobe', 'brain', ['brain|left occipital lobe']),
    ('Cerebellum', 'brain', ['brain|cerebellum']),
    ('Medulla oblongata', 'brain', ['brain|medulla oblongata']),
    ('Pons (brainstem)', 'brain', ['brain|pons']),
    ('Eyeball', 'eyes', ['eyes|eyeball']),
    ('Frontalis', 'muscles', ['muscles|left frontalis']),
    ('Temporalis', 'muscles', ['muscles|right temporalis']),
    ('Masseter', 'muscles', ['muscles|superficial part of left masseter']),
    ('Orbicularis oculi', 'muscles', ['muscles|orbital part of right orbicularis oculi']),
    ('Zygomaticus major', 'muscles', ['muscles|right zygomaticus major']),
    ('Orbicularis oris', 'muscles', ['muscles|orbicularis oris']),
    ('Nasalis', 'muscles', ['muscles|right nasalis']),
    ('Depressor anguli oris', 'muscles', ['musclesJaw|left depressor anguli oris']),
    ('Mentalis', 'muscles', ['musclesJaw|right mentalis']),
]
SIDE_FILTER = {'Eyeball': lambda v: v[:, 0] < 0}  # one eyeball file holds both eyes: use the right one
HEAD_CENTER = np.array([0.0, 3.0, -4.0])

sc = trimesh.load('head_raw.glb')
geo = {name: g for name, g in sc.geometry.items()}
out = []
for text, layer, parts in LABELS:
    v = np.concatenate([geo[p].vertices for p in parts])
    if text in SIDE_FILTER: v = v[SIDE_FILTER[text](v)]
    c = v.mean(0)
    d = c - HEAD_CENTER; d /= np.linalg.norm(d)
    rel = v - HEAD_CENTER
    along = rel @ d
    perp = np.linalg.norm(rel - np.outer(along, d), axis=1)
    near = perp < np.percentile(perp, 15)          # vertices close to the centre line
    i = np.argmax(np.where(near, along, -1e9))      # the outermost of those
    out.append({'text': text, 'layer': layer, 'jaw': parts[0].startswith(('jaw|', 'musclesJaw|')),  # these move with the jaw
                'anchor': np.round(v[i], 3).tolist(), 'normal': np.round(d, 3).tolist()})
    print(f'{text:28s} {layer:8s} anchor {np.round(v[i], 1)}')
json.dump(out, open('labels.json', 'w'), indent=1)
