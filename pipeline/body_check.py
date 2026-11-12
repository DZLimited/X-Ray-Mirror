import json, trimesh, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
meta=json.load(open('body_meta.json')); sc=trimesh.load('body_raw.glb'); head=trimesh.load('head_raw.glb')
M=np.array(meta['headToTorso']).reshape(4,4).T   # column-major -> matrix
J={k:np.array(v) for k,v in meta['joints'].items()}
S=(J['shoulderL']+J['shoulderR'])/2; Hm=(J['hipL']+J['hipR'])/2
X=J['shoulderL']-J['shoulderR']; X/=np.linalg.norm(X); Y=S-Hm; Y-=X*(Y@X); Y/=np.linalg.norm(Y); Z=np.cross(X,Y)
Zt=Z
def seg_frame(a,b):
    y=b-a; L=np.linalg.norm(y); y/=L; z=Zt-y*(Zt@y); z/=np.linalg.norm(z); x=np.cross(y,z); return np.stack([x,y,z],1)
Rt=np.stack([X,Y,Z],1)
def to_torso(p): return (p-S)@Rt
pts={'torso':[],'arms':[],'neck':[],'skull':[]}
for name,g in sc.geometry.items():
    key=name.split('|')[0]; v=g.vertices
    if key=='torso': pts['torso'].append(v)
    elif key.startswith('neck'): pts['neck'].append((np.c_[v,np.ones(len(v))]@M.T)[:,:3])
    else:
        seg=meta['segments'][key]; R=seg_frame(J[seg['a']],J[seg['b']]); pts['arms'].append(to_torso(v@R.T+J[seg['a']]))
for name,g in head.geometry.items():
    if name.split('|')[0] in ('cranium','jaw'): pts['skull'].append((np.c_[g.vertices,np.ones(len(g.vertices))]@M.T)[:,:3])
col={'torso':'#bfe3ff','arms':'#ffd27a','neck':'#ff7ab0','skull':'#e9e2d0'}
fig,axs=plt.subplots(1,2,figsize=(12,8),facecolor='#0b0e13')
for ax,(i,j,t) in zip(axs,[(0,1,'front (torso frame)'),(2,1,'side, forward = right')]):
    ax.set_facecolor('#0b0e13')
    for k,L in pts.items():
        v=np.vstack(L)[::4]; ax.scatter(v[:,i],v[:,j],s=0.2,c=col[k],alpha=0.4)
    for k in ['shoulderL','shoulderR','elbowL','elbowR','wristL','wristR','hipL','hipR']:
        p=to_torso(J[k]); ax.scatter([p[i]],[p[j]],c='#ff3355',s=25)
    ax.set_aspect('equal'); ax.set_title(t,color='w'); ax.tick_params(colors='#555')
plt.savefig('/home/claude/body_check.png',dpi=70)
