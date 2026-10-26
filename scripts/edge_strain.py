"""Strain in the band along one edge (the meter for "is the rim squeezed?").

    python scripts/edge_strain.py runs/<run> [frame ...]

Top-sheet mesh edges are grouped by depth from the bottom side (flat y
minimum) and by direction: "along" (within 30° of the side) and "across"
(within 30° of its normal). Strain = length now / length on frame 0 − 1,
so plastic stretch counts as strain too. Negative = squeezed.
"""
import json, math, os, struct, sys

d = sys.argv[1]
m = json.load(open(os.path.join(d, 'mesh.json')))
fr = sorted(os.listdir(os.path.join(d, 'frames')))
def frame(k):
    raw = open(os.path.join(d, 'frames', fr[k]), 'rb').read()
    f = struct.unpack(f'<{len(raw)//4}f', raw)
    return [f[i:i + 3] for i in range(0, len(f), 3)]
p0 = frame(0)
top = m['indices'][:3 * m['topTriangles']]
edges = set()
for t in range(0, len(top), 3):
    a, b, c = top[t:t + 3]
    for u, v in ((a, b), (b, c), (c, a)):
        edges.add((min(u, v), max(u, v)))
y0 = min(p0[i][1] for i in set(top))
frames = [int(x) for x in sys.argv[2:]] or [len(fr) - 1]
bands = [(0, 3), (3, 10), (10, 25), (25, 50), (50, 90)]
print('depth mm      ' + '  '.join(f'f{k:<4} along   across ' for k in frames))
for lo, hi in bands:
    row = f'{lo:3}-{hi:<3}      '
    for k in frames:
        pk = frame(k)
        sums = {'along': [], 'across': []}
        for u, v in edges:
            dx, dy = p0[v][0] - p0[u][0], p0[v][1] - p0[u][1]
            depth = (p0[u][1] + p0[v][1]) / 2 - y0
            if not (lo <= depth < hi):
                continue
            l0 = math.hypot(dx, dy)
            ang = abs(math.degrees(math.atan2(dy, dx))) % 180
            key = 'along' if ang < 30 or ang > 150 else ('across' if 60 < ang < 120 else None)
            if key:
                sums[key].append(math.dist(pk[u], pk[v]) / l0 - 1)
        a = sums['along']; c = sums['across']
        row += f'      {100*sum(a)/max(len(a),1):+6.2f}% {100*min(a or [0]):+6.2f}% {100*sum(c)/max(len(c),1):+6.2f}%'
    print(row)
print('(per frame: mean along, most squeezed along, mean across)')
