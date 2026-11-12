# Step 2: turn the resolved part lists into the layers the app uses.
import json, re
d = json.load(open('parts.json')); g = d['groups']; n = d['names']
lower = lambda x: ' lower ' in ' ' + n[x] + ' '
cranium = [x for x in g['skull'] if n[x] not in ('hyoid bone', 'gingiva of lower jaw')] + [x for x in g['teeth'] if not lower(x)]
jaw = g['mandible'] + [x for x in g['teeth'] if lower(x)] + [x for x in g['skull'] if n[x] == 'gingiva of lower jaw']
jaw_muscles = ('mentalis', 'depressor labii inferioris', 'depressor anguli oris')
mj = [x for x in g['muscles'] if any(k in n[x] for k in jaw_muscles)]
mu = [x for x in g['muscles'] if x not in mj]
bones = re.compile('phalanx|metacarpal|scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate')
hand = [x for x in g['hand'] if bones.search(n[x])]
out = {'cranium': cranium, 'jaw': jaw, 'brain': g['brain'], 'eyes': g['eyes'], 'muscles': mu, 'musclesJaw': mj,
       'handRight': [x for x in hand if 'right' in n[x]], 'handLeft': [x for x in hand if 'left' in n[x]]}
json.dump({'groups': out, 'names': n}, open('groups.json', 'w'), indent=1)
open('paths.txt', 'w').write('\n'.join(f'assets/BodyParts3D_data/stl/{x}.stl' for v in out.values() for x in v) + '\nassets/BodyParts3D_data/stl/FMA7163.stl')
for k, v in out.items(): print(k, len(v))
