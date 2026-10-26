"""Gross-shape checks against exact answers (research brief Rev B).

    python scripts/benchmarks.py runs/<run> [runs/<run> ...]

For each run (last frame vs frame 0):
- area ratio: inflated surface area / flat area. In the Geometric/Pillow
  band a real sheet barely stretches and crimps, so this should be <= 1;
  above 1 means the surface is stretching like rubber.
- height: total thickness (top to bottom).
- circle (Mylar balloon, Paulsen): inflated radius / flat radius should be
  ~0.763, and thickness / inflated radius ~1.198.
- square (teabag): volume / side^3 should be ~0.2055 (upper bound 0.217).
"""
import json, math, os, struct, sys

def load(d, k):
    fr = sorted(os.listdir(os.path.join(d, 'frames')))
    raw = open(os.path.join(d, 'frames', fr[k]), 'rb').read()
    f = struct.unpack(f'<{len(raw)//4}f', raw)
    return [f[i:i + 3] for i in range(0, len(f), 3)]

def area(p, tris):
    s = 0.0
    for a, b, c in tris:
        u = [p[b][i] - p[a][i] for i in range(3)]
        v = [p[c][i] - p[a][i] for i in range(3)]
        cx = u[1]*v[2] - u[2]*v[1]; cy = u[2]*v[0] - u[0]*v[2]; cz = u[0]*v[1] - u[1]*v[0]
        s += 0.5 * math.sqrt(cx*cx + cy*cy + cz*cz)
    return s

def volume(p, tris):
    s = 0.0
    for a, b, c in tris:
        A, B, C = p[a], p[b], p[c]
        s += (A[0]*(B[1]*C[2] - B[2]*C[1]) - A[1]*(B[0]*C[2] - B[2]*C[0]) + A[2]*(B[0]*C[1] - B[1]*C[0])) / 6
    return abs(s)

print(f'{"run":22} {"shape":8} {"area ratio":>10} {"height mm":>9} {"check":>28}')
for d in sys.argv[1:]:
    m = json.load(open(os.path.join(d, 'mesh.json')))
    idx = m['indices']
    tris = [idx[i:i + 3] for i in range(0, len(idx), 3)]
    p0, p1 = load(d, 0), load(d, -1)
    ar = area(p1, tris) / area(p0, tris)
    zs = [q[2] for q in p1]
    h = max(zs) - min(zs)
    shape = m.get('shape', '?')
    weld = [i for i, w in enumerate(m['weld']) if w]
    cx = sum(q[0] for q in p0) / len(p0); cy = sum(q[1] for q in p0) / len(p0)
    check = ''
    if shape == 'circle':
        r0 = max(math.hypot(p0[i][0] - cx, p0[i][1] - cy) for i in weld)
        r1 = max(math.hypot(q[0] - cx, q[1] - cy) for q in p1)
        check = f'R/R0 {r1/r0:.3f} (0.763)  H/R {h/r1:.3f} (1.198)'
    elif shape == 'square':
        side = max(q[0] for q in p0) - min(q[0] for q in p0)
        check = f'V/side^3 {volume(p1, tris)/side**3:.4f} (0.2055)'
    print(f'{os.path.basename(d):22} {shape:8} {ar:10.4f} {h:9.1f}   {check}')
