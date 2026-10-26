"""Render CLI runs to a picture without the browser (for tuning checks).

    python scripts/render_run.py out.ppm [--look chrome|zebra] [--el 55] [--az -30] run1 run2 ...

Each run's last frame is drawn side by side (orthographic, flat background):
chrome = a studio-like reflection (bright soft bands top and sides, dark
floor) so folds read as they do in the photos; zebra = stripes of the
reflection, which show every dent. Convert the PPM to PNG with
scripts/ppm2png.ps1.
"""
import json, math, os, struct, sys

args = sys.argv[1:]
out = args.pop(0)
look, el, az, size = 'chrome', 55.0, -30.0, 520
while args and args[0].startswith('--'):
    k, v = args.pop(0), args.pop(0)
    if k == '--look': look = v
    elif k == '--el': el = float(v)
    elif k == '--az': az = float(v)
    elif k == '--size': size = int(v)
runs = args

def load(d):
    # run@N draws frame N instead of the last one (raw solver mesh only).
    d, _, at = d.partition('@')
    m = json.load(open(os.path.join(d, 'mesh.json')))
    fr = sorted(os.listdir(os.path.join(d, 'frames')))
    raw = open(os.path.join(d, 'frames', fr[int(at)] if at else fr[-1]), 'rb').read()
    f = struct.unpack(f'<{len(raw)//4}f', raw)
    return [f[i:i + 3] for i in range(0, len(f), 3)], m['indices']

def norm(v):
    l = math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) or 1.0
    return (v[0]/l, v[1]/l, v[2]/l)

ca, sa = math.cos(math.radians(az)), math.sin(math.radians(az))
ce, se = math.cos(math.radians(el)), math.sin(math.radians(el))
def view(p):  # world (z up) → camera (x right, y up, z toward viewer)
    x, y, z = p[0]*ca - p[1]*sa, p[0]*sa + p[1]*ca, p[2]
    return (x, y*se + z*ce, -y*ce + z*se)

def env(r):  # reflection direction (camera space) → brightness 0..1
    up = r[1]
    if look == 'zebra':
        a = math.atan2(r[0], r[2]) * 6 + up * 9
        return 1.0 if math.sin(a * 2.2) > 0 else 0.05
    sky = 0.25 + 0.75 * max(0.0, up) ** 0.6
    band = math.exp(-((up - 0.35) / 0.08) ** 2) + 0.6 * math.exp(-((r[0] - 0.6) / 0.12) ** 2) * (up > -0.2)
    floor = 0.05 + 0.1 * max(0.0, -up)
    return min(1.0, (sky if up > 0 else floor) + 0.9 * band)

W = size * len(runs)
img = bytearray([18, 19, 22] * (W * size))
zbuf = [-1e30] * (W * size)
for k, name in enumerate(runs):
    pos, idx = load(name)
    vp = [view(p) for p in pos]
    vn = [[0.0, 0.0, 0.0] for _ in pos]
    for t in range(0, len(idx), 3):
        a, b, c = idx[t], idx[t+1], idx[t+2]
        u = [vp[b][i] - vp[a][i] for i in range(3)]; v = [vp[c][i] - vp[a][i] for i in range(3)]
        n = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
        for i in (a, b, c):
            for j in range(3): vn[i][j] += n[j]
    vn = [norm(n) for n in vn]
    xs, ys = [p[0] for p in vp], [p[1] for p in vp]
    span = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.08
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    sc = size / span
    sp = [((p[0]-cx)*sc + size/2 + k*size, size/2 - (p[1]-cy)*sc, p[2]) for p in vp]
    for t in range(0, len(idx), 3):
        tri = (idx[t], idx[t+1], idx[t+2])
        (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = (sp[i] for i in tri)
        area = (x1-x0)*(y2-y0) - (x2-x0)*(y1-y0)
        if abs(area) < 1e-9: continue
        for xi in range(max(k*size, int(min(x0, x1, x2))), min((k+1)*size - 1, int(max(x0, x1, x2)) + 1) + 1):
            for yi in range(max(0, int(min(y0, y1, y2))), min(size - 1, int(max(y0, y1, y2)) + 1) + 1):
                px, py = xi + 0.5, yi + 0.5
                w0 = ((x1-px)*(y2-py) - (x2-px)*(y1-py)) / area
                w1 = ((x2-px)*(y0-py) - (x0-px)*(y2-py)) / area
                w2 = 1 - w0 - w1
                if w0 < 0 or w1 < 0 or w2 < 0: continue
                z = w0*z0 + w1*z1 + w2*z2
                o = yi*W + xi
                if z <= zbuf[o]: continue
                zbuf[o] = z
                n = norm(tuple(w0*vn[tri[0]][j] + w1*vn[tri[1]][j] + w2*vn[tri[2]][j] for j in range(3)))
                if n[2] < 0: n = (-n[0], -n[1], -n[2])
                d = n[2]  # view dir (0,0,1): reflect = 2(n·v)n − v
                r = (2*d*n[0], 2*d*n[1], 2*d*n[2] - 1)
                b = env(r)
                col = (int(255*b), int(255*b), int(min(255, 255*b*1.03 + 4)))
                img[3*o:3*o+3] = bytes(col)
with open(out, 'wb') as f:
    f.write(f'P6 {W} {size} 255\n'.encode()); f.write(img)
print(out, W, 'x', size)
