import json, trimesh, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
sc=trimesh.load('head_raw.glb'); meta=json.load(open('head_meta.json')); P=np.array(meta['jawPivot'])
def open_jaw(v,t,maxdeg=26):
    a=np.radians(maxdeg*t); c,s=np.cos(a),np.sin(a)
    r=v-P; y=r[:,1]*c-r[:,2]*s; z=r[:,1]*s+r[:,2]*c
    return np.stack([r[:,0],y,z],1)+P+np.array([0,-0.25*t,0.7*t])
fig,axs=plt.subplots(1,3,figsize=(15,5.5),facecolor='#0b0e13')
for ax,t in zip(axs,[0,0.5,1]):
    ax.set_facecolor('#0b0e13')
    for name,g in sc.geometry.items():
        grp=name.split('|')[0]
        if grp not in('cranium','jaw'): continue
        v=g.vertices
        if grp=='jaw': v=open_jaw(v,t)
        v=v[np.abs(v[:,0])>3.5] if False else v
        ax.scatter(v[:,2],v[:,1],s=0.3,c='#9fd0ff' if grp=='jaw' else '#cfd8e3',alpha=0.4,linewidths=0)
    ax.scatter([P[2]+0.7*t],[P[1]-0.25*t],c='#ff3355',marker='x',s=60)
    ax.set_xlim(-8,8);ax.set_ylim(-10,6);ax.set_aspect('equal');ax.set_title(f'jaw {int(t*100)}%  (side, nose right)',color='w');ax.tick_params(colors='#555')
plt.tight_layout();plt.savefig('/home/claude/jaw_side.png',dpi=80)
