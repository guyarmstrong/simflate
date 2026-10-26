"""Trace a black-on-white silhouette grid into a BlownSim pieces file.

    python scripts/trace_silhouette.py grid.txt out.json WIDTH_MM HEIGHT_MM

grid.txt: one text row per pixel row, '1' = shape. The outline of the biggest
shape is traced along pixel edges, smoothed (the pixel stair-steps removed),
resampled evenly and scaled to the given flat size (bounding box, mm).
"""
import json, math, sys

grid_path, out_path, W, H = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
rows = [r for r in open(grid_path).read().split('\n') if r]
h, w = len(rows), len(rows[0])
on = lambda x, y: 0 <= x < w and 0 <= y < h and rows[y][x] == '1'

# Directed pixel-edge segments with the shape on the left (y down).
nxt = {}
for y in range(h):
    for x in range(w):
        if not on(x, y):
            continue
        if not on(x, y - 1): nxt[(x + 1, y)] = (x, y)
        if not on(x, y + 1): nxt[(x, y + 1)] = (x + 1, y + 1)
        if not on(x - 1, y): nxt[(x, y)] = (x, y + 1)
        if not on(x + 1, y): nxt[(x + 1, y + 1)] = (x + 1, y)

# Chain into loops; keep the longest.
loops, seen = [], set()
for start in list(nxt):
    if start in seen:
        continue
    loop, p = [], start
    while p not in seen and p in nxt:
        seen.add(p); loop.append(p); p = nxt[p]
    loops.append(loop)
pts = max(loops, key=len)

# Smooth away the stair-steps, then resample to even spacing.
def smooth(p, n):
    for _ in range(n):
        p = [((p[i - 1][0] + 2 * p[i][0] + p[(i + 1) % len(p)][0]) / 4,
              (p[i - 1][1] + 2 * p[i][1] + p[(i + 1) % len(p)][1]) / 4) for i in range(len(p))]
    return p
pts = smooth(pts, 6)
per = sum(math.dist(pts[i], pts[i - 1]) for i in range(len(pts)))
N = 240
step, out, acc = per / N, [pts[0]], 0.0
for i in range(1, len(pts) + 1):
    a, b = pts[i - 1], pts[i % len(pts)]
    d = math.dist(a, b)
    while acc + d >= step and len(out) < N:
        t = (step - acc) / d
        a = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        out.append(a); d = math.dist(a, b); acc = 0.0
    acc += d

xs, ys = [p[0] for p in out], [p[1] for p in out]
sx, sy = W / (max(xs) - min(xs)), H / (max(ys) - min(ys))
print(f'pixel box {max(xs)-min(xs):.0f} x {max(ys)-min(ys):.0f}, scale x {sx:.3f} y {sy:.3f} mm/px (should match)')
s = (sx + sy) / 2
cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
outer = [[round((x - cx) * s, 3), round(-(y - cy) * s, 3)] for x, y in out]
area = sum(outer[i - 1][0] * outer[i][1] - outer[i][0] * outer[i - 1][1] for i in range(len(outer))) / 2
if area < 0:
    outer.reverse()
json.dump([{'outer': outer}], open(out_path, 'w'))
print(f'{out_path}: {len(outer)} points, {abs(area) / 100:.0f} cm²')
