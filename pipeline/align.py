import json, trimesh, numpy as np
D='/tmp/bp3d/repo/assets/BodyParts3D_data/stl'
G=json.load(open('groups.json'));g=G['groups'];n=G['names']
canon=np.array(json.load(open('/home/claude/xray-mirror/src/core/canonicalFace.json'))['positions']).reshape(-1,3)
def to_head(v): # BP mm (x=body left, y=back, z=up) -> head cm (x=left, y=up, z=forward)
    v=np.asarray(v,float); return np.stack([v[...,0], v[...,2], -v[...,1]],-1)/10
eyes=trimesh.load(f"{D}/{g['eyes'][0]}.stl")
parts=eyes.split(only_watertight=False)
cs=sorted([to_head(p.centroid) for p in parts if len(p.faces)>500], key=lambda c:c[0])
print('BP eye centers', np.round(cs,2), len(parts))
bp_eye_mid=(cs[0]+cs[-1])/2; bp_ipd=cs[-1][0]-cs[0][0]
mand=trimesh.load(f"{D}/{[x for x in g['jaw'] if n[x]=='mandible'][0]}.stl")
mv=to_head(mand.vertices)
# menton: lowest point near midline
mid=mv[np.abs(mv[:,0])<0.5]; menton=mid[np.argmin(mid[:,1])]
print('BP menton', np.round(menton,2))
# canonical: eye canthi (33,133 right; 263,362 left), chin 152
ce_r=(canon[33]+canon[133])/2; ce_l=(canon[263]+canon[362])/2
print('canon canthi mids', np.round(ce_r,2), np.round(ce_l,2))
c_eye_mid=(ce_r+ce_l)/2 + np.array([0,0,-1.0])   # eyeball centre ~1 cm behind the canthi line
c_ipd=ce_l[0]-ce_r[0]
c_menton=canon[152] + np.array([0,0.7,-0.6])      # bone is ~7 mm inside the skin at the chin
print('canon eye mid', np.round(c_eye_mid,2), 'ipd', round(c_ipd,2), 'bp ipd', round(bp_ipd,2))
# sagittal similarity from (eye_mid, menton)
a=menton-bp_eye_mid; b=c_menton-c_eye_mid
s_v=np.linalg.norm(b[1:])/np.linalg.norm(a[1:]); s_h=c_ipd/bp_ipd; s=(s_v+s_h)/2
ang=np.arctan2(b[2],b[1])-np.arctan2(a[2],a[1])  # rotation about x (pitch)
print('scale vertical',round(s_v,3),'horizontal',round(s_h,3),'-> s',round(s,3),'pitch deg',round(np.degrees(ang),1))
c,sn=np.cos(ang),np.sin(ang)
R=np.array([[1,0,0],[0,c,-sn],[0,sn,c]])
# y,z rotate: [y',z'] = [[c,-s],[s,c]][y,z]  -> check direction
def T(p): return (R@((p-bp_eye_mid)*s).T).T + c_eye_mid
print('check menton ->', np.round(T(menton),2), 'target', np.round(c_menton,2))
json.dump({'bp_eye_mid':bp_eye_mid.tolist(),'s':s,'R':R.tolist(),'c_eye_mid':c_eye_mid.tolist()},open('align.json','w'))
