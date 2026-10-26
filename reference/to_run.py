"""Bring OpenCourant results back as a BlownSim run (Snapshots -> Test runs,
render_run.py, benchmarks.py all work on it).

    python reference/to_run.py <ref-dir> <out-run-dir>

Reads <ref-dir>/deck.json (which BlownSim mesh run it came from) and every
modelA###.vtk frame; writes <out-run-dir>/mesh.json (the source mesh),
frames/00000.bin… (positions in BlownSim vertex order: node id - 1) and
manifest.json (height, volume, peak plastic strain per frame).
"""
import json, math, os, shutil, struct, sys

ref, out = sys.argv[1], sys.argv[2]
deck = json.load(open(os.path.join(ref, 'deck.json')))
src = deck['source']
mesh = json.load(open(os.path.join(src, 'mesh.json')))
idx = mesh['indices']
tris = [idx[i:i + 3] for i in range(0, len(idx), 3)]
n = mesh['vertexCount']


def read_vtk(path):
    lines = open(path).read().split('\n')
    def block(header, count, per):
        i = next(k for k, l in enumerate(lines) if l.startswith(header))
        j = i + 1
        if lines[j].startswith('LOOKUP_TABLE'):
            j += 1
        vals = []
        while len(vals) < count * per:
            vals += lines[j].split()
            j += 1
        return vals[:count * per]
    npts = int(next(l for l in lines if l.startswith('POINTS')).split()[1])
    pts = [float(v) for v in block('POINTS', npts, 3)]
    ids = [int(v) for v in block('SCALARS NODE_ID', npts, 1)]
    ncell = int(next(l for l in lines if l.startswith('CELL_DATA')).split()[1])
    ep = [float(v) for v in block('SCALARS 2DELEM_Plastic_Strain ', ncell, 1)] if any(
        l.startswith('SCALARS 2DELEM_Plastic_Strain ') for l in lines) else [0.0]
    time = 0.0
    for k, l in enumerate(lines[:10]):
        if l.startswith('TIME'):
            time = float(lines[k + 1])
    pos = [0.0] * (3 * n)
    for k, nid in enumerate(ids):
        v = nid - 1
        if 0 <= v < n:
            pos[3 * v:3 * v + 3] = pts[3 * k:3 * k + 3]
    return pos, max(ep), time


def volume(p):
    s = 0.0
    for a, b, c in tris:
        A, B, C = p[3 * a:3 * a + 3], p[3 * b:3 * b + 3], p[3 * c:3 * c + 3]
        s += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6
    return abs(s)


frames = sorted(f for f in os.listdir(ref) if f.startswith('modelA') and f.endswith('.vtk'))
os.makedirs(os.path.join(out, 'frames'), exist_ok=True)
for f in os.listdir(os.path.join(out, 'frames')):
    os.remove(os.path.join(out, 'frames', f))
name = os.path.basename(out.rstrip('/\\'))
m2 = dict(mesh, name=name, shape=mesh.get('shape', 'custom') + ' (reference)')
json.dump(m2, open(os.path.join(out, 'mesh.json'), 'w'))
infos = []
for k, f in enumerate(frames):
    pos, ep, time = read_vtk(os.path.join(ref, f))
    open(os.path.join(out, 'frames', f'{k:05d}.bin'), 'wb').write(struct.pack(f'<{len(pos)}f', *pos))
    zs = pos[2::3]
    infos.append({'frame': k, 'time': time, 'heightMm': max(zs) - min(zs), 'volumeMl': volume(pos) / 1000.0,
                  'maxStretchPct': 100.0 * ep, 'pressure': 0.0, 'contactFraction': 0.0, 'motion': 0.0,
                  'stable': True, 'status': 'settled' if k == len(frames) - 1 else 'running'})
    print(f'frame {k:3d}  t {time:.4f}s  height {infos[-1]["heightMm"]:7.1f} mm  volume {infos[-1]["volumeMl"]:8.0f} ml  peak plastic strain {100 * ep:5.1f} %')
json.dump({'name': name, 'frames': len(frames), 'done': True, 'info': infos}, open(os.path.join(out, 'manifest.json'), 'w'))
print(f'-> {out}: {len(frames)} frames')
