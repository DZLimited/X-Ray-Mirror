# Model pipeline (how public/models/head.glb was made)

You don't need to run this; `head.glb` is already in `public/models/`.
It's here so you can see how it was made, change it, and rebuild it.

Source: BodyParts3D 3.0, via the STL mirror at
https://github.com/Kevin-Mattheus-Moerman/BodyParts3D
License: CC BY-SA 2.1 Japan. "BodyParts3D, © The Database Center for Life Science".
Because of share-alike, the converted head.glb is under the same license.

## Requirements
Python 3 with: `pip install trimesh fast-simplification scipy numpy matplotlib`
Node (for compression): `npx gltfpack`

## Steps (run inside this folder; the scripts use /tmp/bp3d as the data path, edit if needed)
```bash
# 0. get the data (only the files we need)
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/Kevin-Mattheus-Moerman/BodyParts3D /tmp/bp3d/repo
cd /tmp/bp3d/repo && git checkout HEAD -- assets/BodyParts3D_data/*.txt assets/BodyParts3D_data/FMA.csv && cd -

python resolve.py /tmp/bp3d/repo/assets/BodyParts3D_data parts.json   # 1. composite parts -> STL files
python make_groups.py                                                  # 2. app layers (skull/jaw/brain/...)
(cd /tmp/bp3d/repo && xargs -a "$OLDPWD/paths.txt" git checkout HEAD --)  # download those STLs (~200 MB)
python align.py      # 3. rough alignment: eyes + chin
python icp.py        # 4. accurate alignment: fit anatomy skin onto MediaPipe's canonical face (ICP with scale)
python build_head.py # 5. transform + simplify (~2.5M -> ~207k triangles) -> head_raw.glb + head_meta.json
python preview.py    # optional: front/side check image
npx gltfpack -i head_raw.glb -o head.glb -cc -kn -vp 14 -vn 8   # 6. compress (3.8 MB -> ~1 MB)
```
Then copy `head.glb` to `public/models/` and the jawPivot/condyles/bounds/groups from
`head_meta.json` into `src/core/headMeta.json`.

## Coordinate system
BodyParts3D: millimetres, x = body's left, y = towards the back, z = up.
Head space (MediaPipe canonical face): centimetres, x = face's left, y = up, z = out of the nose.
Result of the ICP fit: scale 1.06, ~2 mm mean distance between the anatomy's skin and MediaPipe's face.

## Hand bones (public/models/hand.glb)
```bash
python build_hand.py   # finds joint positions on the model (numbered like MediaPipe's 21 hand points),
                       # stores every bone in a local frame between two joints -> hand_raw.glb + hand_meta.json
python hand_check.py   # rebuilds the hand from its joints the same way the app does (error should be ~0)
npx gltfpack -i hand_raw.glb -o hand.glb -cc -kn -vp 14 -vn 8
```
Copy `palm` and `segments` from `hand_meta.json` into `src/core/handMeta.json`.

## Labels (src/core/labels.json)
```bash
python build_labels.py   # one anchor point per label, on the outer surface of its part(s)
```
Edit the LABELS list in the script to add or rename labels, then copy labels.json to src/core/.

## Upper body (public/models/body.glb)
```bash
python resolve_body.py   # which STL files: ribs, sternum, spine, clavicles, scapulae, arms, femurs (for the hip joints)
(cd /tmp/bp3d/repo && xargs -a "$OLDPWD/body_paths.txt" git checkout HEAD --)
python build_body.py     # joints matched to MediaPipe Pose, torso/arm frames, neck in head space -> body_raw.glb + body_meta.json
python body_check.py     # puts skull, neck, torso and arms together in one picture to check they connect
npx gltfpack -i body_raw.glb -o body.glb -cc -kn -vp 14 -vn 8
```
Copy torso/segments/neck/headToTorso/labels from body_meta.json into src/core/bodyMeta.json.
