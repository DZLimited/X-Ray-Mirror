# Similarity ICP: fit MediaPipe canonical face (468 pts) onto BodyParts3D face skin.
import json, trimesh, numpy as np
from scipy.spatial import cKDTree
D='/tmp/bp3d/repo/assets/BodyParts3D_data/stl'
A=json.load(open('align.json')); bp_eye_mid=np.array(A['bp_eye_mid']); R=np.array(A['R']); c_eye_mid=np.array(A['c_eye_mid'])
def to_head(v): v=np.asarray(v,float); return np.stack([v[...,0], v[...,2], -v[...,1]],-1)/10
def T0(v): return (R@(to_head(v)-bp_eye_mid).T).T + c_eye_mid    # rigid only, no scale
skin=trimesh.load(f'{D}/FMA7163.stl')
v=T0(skin.vertices)
keep=(v[:,1]>-14)&(v[:,1]<14)&(v[:,2]>-5)
face=trimesh.Trimesh(v,skin.faces,process=False); face.update_faces(np.all(keep[skin.faces],axis=1)); face.remove_unreferenced_vertices()
pts,_=trimesh.sample.sample_surface_even(face, 120000)
tree=cKDTree(pts)
canon=np.array(json.load(open('/home/claude/xray-mirror/src/core/canonicalFace.json'))['positions']).reshape(-1,3)
def umeyama(src,dst):
    ms,md=src.mean(0),dst.mean(0); X=src-ms; Y=dst-md
    U,S,Vt=np.linalg.svd(Y.T@X/len(src)); d=np.sign(np.linalg.det(U@Vt)); Dg=np.diag([1,1,d])
    Rm=U@Dg@Vt; s=np.trace(np.diag(S)@Dg)/X.var(0).sum(); t=md-s*Rm@ms; return s,Rm,t
s,Rm,t=1.0,np.eye(3),np.zeros(3)
for it in range(80):
    cur=s*(Rm@canon.T).T+t
    dist,idx=tree.query(cur)
    m=dist<np.percentile(dist,85)
    s,Rm,t=umeyama(canon[m],pts[idx[m]])
cur=s*(Rm@canon.T).T+t; dist,_=tree.query(cur)
ang=np.degrees(np.arccos(np.clip((np.trace(Rm)-1)/2,-1,1)))
print(f'canon->BP scale {s:.4f} (BP->canon {1/s:.4f}), rot {ang:.1f} deg, mean dist {dist.mean():.3f} cm, p90 {np.percentile(dist,90):.3f}')
json.dump({'s':1/s,'R':Rm.T.tolist(),'t':t.tolist(),'bp_eye_mid':bp_eye_mid.tolist(),'R0':R.tolist(),'c_eye_mid':c_eye_mid.tolist()},open('align_icp.json','w'))
