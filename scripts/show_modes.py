"""Picture of the buckling shapes a run found (BLOWN_MODES=<file> on the CLI).

    python scripts/show_modes.py runs/<run> modes.txt out.ppm

One panel per shape: the top sheet seen from above on its flat outline,
red = up, blue = down (each panel scaled to its own largest value).
"""
import json, os, struct, sys

run, modes_file, out = sys.argv[1:4]
m = json.load(open(os.path.join(run, 'mesh.json')))
fr = sorted(os.listdir(os.path.join(run, 'frames')))
raw = open(os.path.join(run, 'frames', fr[0]), 'rb').read()
f = struct.unpack(f'<{len(raw)//4}f', raw)
flat = [(f[i], f[i + 1]) for i in range(0, len(f), 3)]
modes = [list(map(float, line.split())) for line in open(modes_file) if line.strip()]
k = len(modes[0])
top = m['indices'][:3 * m['topTriangles']]
xs = [p[0] for p in flat]; ys = [p[1] for p in flat]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
S = 360
sc = (S - 20) / max(x1 - x0, y1 - y0)
W, H = S * k, S
img = bytearray([20] * (W * H * 3))

def to_px(p, panel):
    return (10 + (p[0] - x0) * sc + panel * S, H - 10 - (p[1] - y0) * sc)

for panel in range(k):
    vals = [row[panel] for row in modes]
    vmax = max(abs(v) for v in vals) or 1.0
    for t in range(0, len(top), 3):
        tri = top[t:t + 3]
        pts = [to_px(flat[i], panel) for i in tri]
        v = sum(vals[i] for i in tri) / 3 / vmax
        col = (int(255 * max(v, 0) + 230 * (1 - abs(v))), int(230 * (1 - abs(v))), int(255 * max(-v, 0) + 230 * (1 - abs(v))))
        minx, maxx = int(min(p[0] for p in pts)), int(max(p[0] for p in pts)) + 1
        miny, maxy = int(min(p[1] for p in pts)), int(max(p[1] for p in pts)) + 1
        (ax, ay), (bx, by), (cx, cy) = pts
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        for py in range(max(miny, 0), min(maxy, H)):
            for px in range(max(minx, 0), min(maxx, W)):
                l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
                l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
                if l1 >= -0.01 and l2 >= -0.01 and 1 - l1 - l2 >= -0.01:
                    o = (py * W + px) * 3
                    img[o:o + 3] = bytes(min(255, max(0, c)) for c in col)
with open(out, 'wb') as fh:
    fh.write(f'P6 {W} {H} 255\n'.encode())
    fh.write(img)
print(out, W, 'x', H)
