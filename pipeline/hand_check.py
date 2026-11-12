import json, trimesh, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
meta=json.load(open('hand_meta.json')); J={int(k):np.array(v) for k,v in meta['joints'].items()}
sc=trimesh.load('hand_raw.glb')
def palm_axes(P):
    y=P[9]-P[0]; y/=np.linalg.norm(y); xs=P[5]-P[17]; xs-=y*(xs@y); xs/=np.linalg.norm(xs); z=np.cross(xs,y); z/=np.linalg.norm(z); return xs,y,z
PX,PY,PZ=palm_axes(J)
def place(key, v):
    if key=='palm': R=np.stack([PX,PY,PZ],1); return v@R.T+J[0]
    s=meta['segments'][key]; a,b=J[s['a']],J[s['b']]
    y=b-a; L=np.linalg.norm(y); y/=L; z=np.cross(PX,y); z/=np.linalg.norm(z); x=np.cross(y,z)
    R=np.stack([x,y,z],1); return (v*(L/s['restLength']))@R.T+a
fig,ax=plt.subplots(figsize=(6,8),facecolor='#0b0e13'); ax.set_facecolor('#0b0e13')
D='/tmp/bp3d/repo/assets/BodyParts3D_data/stl'; G=json.load(open('groups.json')); n=G['names']; ids={n[x]:x for x in G['groups']['handRight']}
errs=[]
for name,g in sc.geometry.items():
    key,bone=name.split('|'); w=place(key,g.vertices)
    orig=trimesh.load(f"{D}/{ids[bone] if bone in ids else ids['right '+bone]}.stl").vertices/10
    errs.append(np.linalg.norm((w.min(0)+w.max(0))/2-(orig.min(0)+orig.max(0))/2))
    ax.scatter(w[:,0],w[:,2],s=0.3,c='#bfe3ff',alpha=0.5,linewidths=0)
P=np.array([J[i] for i in range(21)])
for chain in [[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20]]:
    ax.plot(P[chain,0],P[chain,2],'-o',c='#ffb35c',ms=3,lw=1)
ax.set_aspect('equal'); ax.set_title('BP right hand + MediaPipe-style joints',color='w'); ax.tick_params(colors='#555')
plt.savefig('/home/claude/hand_check.png',dpi=80); print('max centroid error (cm)', round(max(errs),4))
