# Which BodyParts3D STL files make up the upper-body skeleton.
import json, subprocess, collections, sys
D = '/tmp/bp3d/repo/assets/BodyParts3D_data'
names = {}
for line in open(f'{D}/parts_list_e.txt', encoding='utf-8').read().splitlines()[1:]:
    a = line.split('\t')
    if len(a) >= 2: names[a[0]] = a[1]
comp = collections.defaultdict(set)
for line in open(f'{D}/composite_parts.txt', encoding='utf-8').read().splitlines()[1:]:
    a = line.split('\t')
    if len(a) >= 4:
        comp[a[0]].add(a[2]); names.setdefault(a[2], a[3]); names.setdefault(a[0], a[1])
have = {s.split('/')[-1][:-4] for s in subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', 'HEAD', 'stl/'], cwd=D, text=True).split()}
def expand(i, seen=None):
    seen = seen or set()
    if i in seen: return set()
    seen.add(i); out = set()
    if i in have and i not in comp: out.add(i)
    for c in comp.get(i, ()): out |= expand(c, seen)
    if not out and i in have: out.add(i)
    return out
by = lambda n: [k for k, v in names.items() if v == n][0]
G = {
    'thoracic': expand(by('set of thoracic vertebrae')),
    'ribs': expand(by('set of ribs')) | expand(by('costal cartilage')) | {x for x in ('BP24', 'BP28') if x in have},
    'sternum': expand(by('sternum')),
    'clavicleR': {by('right clavicle')}, 'clavicleL': {by('left clavicle')},
    'scapulaR': {by('right scapula')}, 'scapulaL': {by('left scapula')},
    'humerusR': {by('right humerus')}, 'humerusL': {by('left humerus')},
    'radiusR': {by('right radius')}, 'radiusL': {by('left radius')},
    'ulnaR': {by('right ulna')}, 'ulnaL': {by('left ulna')},
    'femurR': {by('right femur')}, 'femurL': {by('left femur')},
}
for n in ['atlas', 'axis', 'third cervical vertebra', 'fourth cervical vertebra', 'fifth cervical vertebra', 'sixth cervical vertebra', 'seventh cervical vertebra']:
    G['cervical|' + n] = {by(n)}
out = {k: sorted(v) for k, v in G.items()}
for k, v in out.items(): print(f'{k:40s} {len(v):3d}  {"; ".join(names[x] for x in v)[:110]}')
json.dump({'groups': out, 'names': {x: names[x] for v in out.values() for x in v}}, open('body_parts.json', 'w'), indent=1)
open('body_paths.txt', 'w').write('\n'.join(f'assets/BodyParts3D_data/stl/{x}.stl' for v in out.values() for x in v))
