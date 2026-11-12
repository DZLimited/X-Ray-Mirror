# BodyParts3D STL -> head-space (cm, MediaPipe canonical frame) -> simplified GLB + metadata
import json, trimesh, numpy as np, fast_simplification as fs
D='/tmp/bp3d/repo/assets/BodyParts3D_data/stl'
G=json.load(open('groups.json')); g=G['groups']; n=G['names']; A=json.load(open('align_icp.json'))
bp_eye_mid=np.array(A['bp_eye_mid']); R0=np.array(A['R0']); c_eye_mid=np.array(A['c_eye_mid'])
Rf=np.array(A['R']); sf=A['s']; tf=np.array(A['t'])
def to_head(v): v=np.asarray(v,float); return np.stack([v[...,0], v[...,2], -v[...,1]],-1)/10
def T0(v): return (R0@(to_head(v)-bp_eye_mid).T).T + c_eye_mid
# skin-fitted similarity (ICP onto MediaPipe canonical face)
def T(v): return sf*(Rf@(T0(v)-tf).T).T
TARGET={'cranium':70000,'jaw':20000,'brain':60000,'eyes':4000,'muscles':45000,'musclesJaw':6000}
scene=trimesh.Scene(); meta={'groups':{},'parts':{}}
for grp,target in TARGET.items():
    meshes=[(x,trimesh.load(f'{D}/{x}.stl')) for x in g[grp]]
    total=sum(len(m.faces) for _,m in meshes); ratio=min(1,target/total)
    nf=0
    for x,m in meshes:
        v=T(m.vertices).astype(np.float32); f=m.faces.astype(np.int64)
        keep=max(ratio, min(1,150/len(f)))
        if keep<0.98: v,f=fs.simplify(v,f,target_reduction=1-keep)
        mm=trimesh.Trimesh(v,f,process=True)
        mm.fix_normals() if False else None
        name=f'{grp}|{n[x]}'
        scene.add_geometry(mm, node_name=name, geom_name=name)
        meta['parts'][name]={'centroid':np.round(mm.centroid,3).tolist(),'faces':len(mm.faces)}
        nf+=len(mm.faces)
    meta['groups'][grp]={'parts':len(meshes),'faces':nf}
    print(f'{grp:11s} {total:8d} -> {nf:7d} faces')
# Head outline: the anatomy's own skin, head + upper neck only (drawn as a glowing silhouette)
skin=trimesh.load(f'{D}/FMA7163.stl')
sv=T(skin.vertices)
keep=(sv[:,1]>-13)&(np.abs(sv[:,0])<10)&(sv[:,2]>-17)&(sv[:,2]<10)
sk=trimesh.Trimesh(sv,skin.faces,process=False); sk.update_faces(np.all(keep[skin.faces],axis=1)); sk.remove_unreferenced_vertices()
# the face skin is a separate piece from the scalp/neck: keep every piece that isn't a tiny crumb
sk=trimesh.util.concatenate([p for p in sk.split(only_watertight=False) if len(p.faces)>300])
v,f=fs.simplify(sk.vertices.astype(np.float32), sk.faces, target_reduction=1-14000/len(sk.faces))
outline=trimesh.Trimesh(v,f,process=True)
scene.add_geometry(outline, node_name='outline|skin of head and neck', geom_name='outline|skin of head and neck')
meta['parts']['outline|skin of head and neck']={'centroid':np.round(outline.centroid,3).tolist(),'faces':len(outline.faces)}
meta['groups']['outline']={'parts':1,'faces':len(outline.faces)}
print('outline faces', len(outline.faces), 'bounds', np.round(outline.bounds,1))
# jaw pivot: top of each mandible condyle
mand=[x for x in g['jaw'] if n[x]=='mandible'][0]
mv=T(trimesh.load(f'{D}/{mand}.stl').vertices)
back=mv[mv[:,2]<np.percentile(mv[:,2],15)]
L=back[back[:,0]>0]; Rr=back[back[:,0]<0]
cL=L[np.argmax(L[:,1])]; cR=Rr[np.argmax(Rr[:,1])]
meta['jawPivot']=np.round((cL+cR)/2,3).tolist(); meta['condyles']=[np.round(cR,3).tolist(),np.round(cL,3).tolist()]
b=scene.bounds; meta['bounds']=np.round(b,2).tolist()
print('jaw pivot',meta['jawPivot'],'bounds',meta['bounds'])
scene.export('/home/claude/pipeline/head_raw.glb', include_normals=True)
json.dump(meta,open('/home/claude/pipeline/head_meta.json','w'),indent=1)
