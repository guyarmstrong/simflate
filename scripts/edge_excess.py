"""Spare edge length a pillow must fold away (the "work backwards" meter).

    python scripts/edge_excess.py runs/<run>[@frame] [y_edge_mm]

For material lines parallel to the flat bottom edge (y = y_edge) at depths
s inward, compares the inflated 3D length of the line (top sheet, averaged
in 10 mm bins so small waves don't count) with its flat length. The
shortfall is metal that, in a sheet that can't squash or stretch, has to go
into waves along that side. Default edge: the CLI triangle's bottom side.
"""
import json, math, os, struct, sys

arg = sys.argv[1]
d, _, at = arg.partition('@')
m = json.load(open(os.path.join(d, 'mesh.json')))
fr = sorted(os.listdir(os.path.join(d, 'frames')))
raw = open(os.path.join(d, 'frames', fr[int(at)] if at else fr[-1]), 'rb').read()
f = struct.unpack(f'<{len(raw)//4}f', raw)
pos = [f[i:i + 3] for i in range(0, len(f), 3)]
# Flat positions = frame 0 (the sheet before inflating), in mm.
r0 = open(os.path.join(d, 'frames', fr[0]), 'rb').read()
f0 = struct.unpack(f'<{len(r0)//4}f', r0)
uv = [(f0[i], f0[i + 1]) for i in range(0, len(f0), 3)]
top = set(m['indices'][:3 * m['topTriangles']])
ys = [uv[i][1] for i in top]
y0 = float(sys.argv[2]) if len(sys.argv) > 2 else min(ys)
xs = [uv[i][0] for i in top if abs(uv[i][1] - y0) < 1]
x_lo, x_hi = min(xs), max(xs)
half = (x_hi - x_lo) / 2
print(f'{d}  frame {at or "last"}  edge y={y0:.0f}, length {x_hi - x_lo:.0f} mm')
print('depth mm   flat mm   3D mm   spare %   seam draw-in mm')
for s in (0, 5, 10, 20, 40, 80, 120):
    # Triangle: the line at depth s runs between the two sloping sides.
    span = half - s * math.sqrt(3) if s else half
    bins = {}
    for i in top:
        x, y = uv[i]
        if abs(y - (y0 + s)) <= 3 and abs(x - (x_lo + half)) < span - 10:
            b = int((x - x_lo) // 10)
            acc = bins.setdefault(b, [0, 0, 0, 0, 0])
            acc[0] += pos[i][0]; acc[1] += pos[i][1]; acc[2] += pos[i][2]; acc[3] += x; acc[4] += 1
    pts = [(a[0]/a[4], a[1]/a[4], a[2]/a[4], a[3]/a[4]) for _, a in sorted(bins.items())]
    if len(pts) < 3:
        continue
    l3 = sum(math.dist(pts[k][:3], pts[k+1][:3]) for k in range(len(pts) - 1))
    lf = pts[-1][3] - pts[0][3]
    mid = min(pts, key=lambda p: abs(p[3] - (x_lo + half)))
    print(f'{s:8.0f}  {lf:8.1f}  {l3:7.1f}  {100*(1 - l3/lf):7.2f}   {mid[1] - (y0 + s):8.1f}')
