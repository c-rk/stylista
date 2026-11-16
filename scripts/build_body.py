#!/usr/bin/env python3
"""
Converts MakeHuman's CC0 base mesh, morph targets, bone weights and measurement loops into the
compact binary consumed by src/three/human. Run once per asset update:

    git clone --depth 1 https://github.com/makehumancommunity/makehuman
    python3 scripts/build_body.py makehuman/makehuman

MakeHuman assets (data/) are CC0; no MakeHuman code is shipped.
"""
import json, re, sys, os
import numpy as np

MH = sys.argv[1]
DATA = os.path.join(MH, 'data')
OUT_BIN = 'assets/body/body.bin'
OUT_META = 'src/three/human/meta.json'
SCALE = 0.1  # MakeHuman units are decimetres

# ---- base mesh -------------------------------------------------------------------------
verts, uvs, faces, group = [], [], {}, None
joints = {}
for line in open(os.path.join(DATA, '3dobjs/base.obj')):
    p = line.split()
    if not p: continue
    if p[0] == 'v': verts.append([float(x) for x in p[1:4]])
    elif p[0] == 'vt': uvs.append([float(x) for x in p[1:3]])
    elif p[0] == 'g': group = p[1]
    elif p[0] == 'f':
        corners = [tuple(int(i) - 1 for i in c.split('/')[:2]) for c in p[1:]]
        if group.startswith('joint-'):
            joints.setdefault(group[6:], set()).update(c[0] for c in corners)
        else:
            faces.setdefault(group, []).append(corners)
verts = np.array(verts, dtype=np.float64)
uvs = np.array(uvs, dtype=np.float32)
NV = len(verts)

blobs, index = [], {}
def put(name, arr):
    arr = np.ascontiguousarray(arr)
    off = sum(len(b) for b in blobs)
    pad = (-off) % 4
    if pad: blobs.append(b'\0' * pad); off += pad
    index[name] = {'dtype': str(arr.dtype), 'offset': off, 'length': int(arr.size)}
    blobs.append(arr.tobytes())

put('base', (verts * SCALE).astype(np.float32))

SETS = {
    'body': ['body'],
    'tights': ['helper-tights'],
    'skirt': ['helper-skirt'],
    'hair': ['helper-hair'],
    'eyes': ['helper-l-eye', 'helper-r-eye'],
}
for name, groups in SETS.items():
    remap, vmap, uv, idx = {}, [], [], []
    for g in groups:
        for f in faces[g]:
            ids = []
            for c in f:
                if c not in remap:
                    remap[c] = len(vmap); vmap.append(c[0]); uv.append(uvs[c[1]])
                ids.append(remap[c])
            for k in range(1, len(ids) - 1): idx += [ids[0], ids[k], ids[k + 1]]
    put(f'{name}.vmap', np.array(vmap, dtype=np.uint16))
    put(f'{name}.uv', np.array(uv, dtype=np.float32))
    put(f'{name}.idx', np.array(idx, dtype=np.uint16 if len(vmap) < 65536 else np.uint32))
    print(name, len(vmap), 'verts', len(idx) // 3, 'tris')

# ---- morph targets ---------------------------------------------------------------------
def target(path):
    d = np.zeros((NV, 3))
    for line in open(os.path.join(DATA, 'targets', path + '.target')):
        if line.startswith('#') or not line.strip(): continue
        p = line.split(); d[int(p[0])] = [float(x) for x in p[1:4]]
    return d

QUANT = 2e-5  # metres per int16 step: +-0.65 m range
def put_target(name, d):
    d = d * SCALE
    nz = np.where(np.abs(d).max(axis=1) > 2e-5)[0]
    q = np.round(d[nz] / QUANT)
    assert np.abs(q).max() < 32767, name
    put(f't.{name}.i', nz.astype(np.uint16))
    put(f't.{name}.d', q.astype(np.int16))

for g, G in (('f', 'female'), ('m', 'male')):
    ethnic = sum(target(f'macrodetails/{e}-{G}-young') for e in ('african', 'asian', 'caucasian')) / 3
    for w, W in (('min', 'minweight'), ('avg', 'averageweight'), ('max', 'maxweight')):
        put_target(f'macro-{g}-{w}', target(f'macrodetails/universal-{G}-young-averagemuscle-{W}') + ethnic)

MEASURES = ['bust-circ', 'underbust-circ', 'waist-circ', 'hips-circ', 'shoulder-dist', 'upperleg-height', 'lowerleg-height', 'thigh-circ', 'upperarm-circ', 'napetowaist-dist', 'neck-circ']
for m in MEASURES:
    for s in ('decr', 'incr'):
        put_target(f'{m}-{s}', target(f'measure/measure-{m}-{s}'))

# ---- measurement loops (vertex index chains) -------------------------------------------
loops = {}
src = open(os.path.join(MH, 'plugins/0_modeling_a_measurement.py')).read()
for m in re.finditer(r"Measures\['measure/measure-([a-z-]+)-decr\|incr'\]\s*=\s*\[([0-9,\s]+)\]", src):
    loops[m.group(1)] = [int(x) for x in m.group(2).split(',')]

# ---- body part weights -----------------------------------------------------------------
W = json.load(open(os.path.join(DATA, 'rigs/default_weights.mhw')))['weights']
def part_of(bone):
    side = 1 if bone.endswith('.L') else 2 if bone.endswith('.R') else 0
    b = bone.split('.')[0]
    if re.match(r'shoulder|upperarm|lowerarm|wrist|finger|metacarpal', b): return 1 + side  # 2,3
    if re.match(r'upperleg|lowerleg|foot|toe', b): return 3 + side                 # 4,5
    if re.match(r'neck|head|jaw|eye|tongue|levator|oculi|orbicularis|oris|risorius|special|temporalis', b): return 1
    return 0  # root, spine, pelvis, breast, clavicle
parts = np.zeros((NV, 6))
detail = np.zeros((NV, 16))
DETAIL = [r'upperarm', r'lowerarm', r'wrist|finger|metacarpal', r'upperleg', r'lowerleg', r'foot|toe']
for bone, pairs in W.items():
    k = part_of(bone)
    for i, w in pairs:
        parts[i, k] += w
        for j, rx in enumerate(DETAIL):
            if re.match(rx, bone): detail[i, j] += w
s = parts.sum(axis=1, keepdims=True); s[s == 0] = 1
put('parts', np.round(parts / s * 255).astype(np.uint8))
# limb: 0 none/torso/head, 1 upper arm, 2 lower arm, 3 hand, 4 upper leg, 5 lower leg, 6 foot
limb = np.where(detail.max(axis=1) > 0.5, detail.argmax(axis=1) + 1, 0)
put('limb', limb.astype(np.uint8))

# MakeHuman's ".L" is the character's left. Record which x sign that is.
arm_l = parts[:, 2] > 0.9
left_sign = 1 if verts[arm_l, 0].mean() > 0 else -1

meta = {
    'vertexCount': NV,
    'quant': QUANT,
    'leftSign': left_sign,
    'arrays': index,
    'joints': {k: sorted(v) for k, v in joints.items() if not re.search(r'toe|finger|tongue|lid|hand-\d|-\d-\d', k)},
    'loops': loops,
    'measures': MEASURES,
}
os.makedirs(os.path.dirname(OUT_META), exist_ok=True)
open(OUT_BIN, 'wb').write(b''.join(blobs))
json.dump(meta, open(OUT_META, 'w'), separators=(',', ':'))
print('bin', os.path.getsize(OUT_BIN), 'meta', os.path.getsize(OUT_META), 'leftSign', left_sign, 'loops', list(loops))
