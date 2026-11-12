import json, trimesh, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
sc=trimesh.load('head_raw.glb'); meta=json.load(open('head_meta.json'))
canon=np.array(json.load(open('/home/claude/xray-mirror/src/core/canonicalFace.json'))['positions']).reshape(-1,3)
col={'cranium':'#cfd8e3','jaw':'#9fb7d0','brain':'#e7a0b8','eyes':'#f2d27a','muscles':'#d9776a','musclesJaw':'#d9776a'}
fig,axs=plt.subplots(1,2,figsize=(12,7),facecolor='#0b0e13')
for ax,(i,j,title) in zip(axs,[(0,1,'front'),(2,1,'side (nose to the right)')]):
    ax.set_facecolor('#0b0e13')
    for name,geom in sc.geometry.items():
        grp=name.split('|')[0]
        if grp in('muscles','musclesJaw'): continue
        v=geom.vertices; ax.scatter(v[:,i],v[:,j],s=0.6,c=col[grp],alpha=0.5,linewidths=0)
    ax.scatter(canon[:,i],canon[:,j],s=7,c='#ffb35c',edgecolors='k',linewidths=0.3)
    p=meta['jawPivot']; ax.scatter([p[i]],[p[j]],s=60,c='#ff3355',marker='x')
    ax.set_aspect('equal'); ax.set_title(title,color='w'); ax.tick_params(colors='#666')
plt.tight_layout(); plt.savefig('/home/claude/pipeline/preview.png',dpi=90)
