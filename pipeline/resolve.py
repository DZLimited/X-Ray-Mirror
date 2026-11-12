# Expand BodyParts3D composite parts into the primitive STL files we need.
import sys, json, subprocess, collections
D = sys.argv[1]
names = {}
for line in open(f'{D}/parts_list_e.txt', encoding='utf-8').read().splitlines()[1:]:
    a = line.split('\t')
    if len(a) >= 2: names[a[0]] = a[1]
comp = collections.defaultdict(set)
for line in open(f'{D}/composite_parts.txt', encoding='utf-8').read().splitlines()[1:]:
    a = line.split('\t')
    if len(a) >= 4: comp[a[0]].add(a[2]); names.setdefault(a[2], a[3]); names.setdefault(a[0], a[1])
stl = set(subprocess.check_output(['git','ls-tree','-r','--name-only','HEAD','stl/'], cwd=D, text=True).split())
have = {s.split('/')[-1][:-4] for s in stl}
def expand(i, seen=None):
    seen = seen or set()
    if i in seen: return set()
    seen.add(i)
    out = set()
    if i in have and i not in comp: out.add(i)
    for c in comp.get(i, ()): out |= expand(c, seen)
    if not out and i in have: out.add(i)
    return out
def find(name):
    hits = [k for k, v in names.items() if v == name]
    assert hits, name
    return hits[0]
G = {
  'skull':   ['skull'],
  'mandible':['mandible'],
  'teeth':   ['incisor tooth','canine tooth','premolar tooth','molar tooth'],
  'brain':   ['brain'],
  'eyes':    ['eyeball'],
  'muscles': ['frontalis','procerus','nasalis','orbicularis oculi','corrugator supercilii','orbicularis oris',
              'depressor anguli oris','risorius','zygomaticus major','zygomaticus minor','levator labii superioris',
              'levator labii superioris alaeque nasi','depressor labii inferioris','levator anguli oris','buccinator',
              'mentalis','masseter','temporalis'],
  'hand':    ['hand'],
}
res = {}
for g, terms in G.items():
    s = set()
    for t in terms: s |= expand(find(t))
    res[g] = sorted(s)
mand = set(res['mandible']); teeth = set(res['teeth'])
res['skull'] = sorted(set(res['skull']) - mand - teeth)
for g, v in res.items():
    print(g, len(v), '|', '; '.join(names.get(x,x) for x in v)[:600])
json.dump({'groups': res, 'names': {x: names.get(x, x) for v in res.values() for x in v}}, open(sys.argv[2], 'w'), indent=1)
