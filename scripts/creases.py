"""Crease numbers for CLI runs: python scripts/creases.py runs <name>...

For each run's last frame: height, permanent stretch, how far the edge drew
in, and how creased the sheet is (sharp folds between neighbouring
triangles, welds excluded)."""
import json, math, os, struct, sys

def load(d):
    m = json.load(open(os.path.join(d, 'mesh.json')))
    frames = sorted(os.listdir(os.path.join(d, 'frames')))
    raw = open(os.path.join(d, 'frames', frames[-1]), 'rb').read()
    f = struct.unpack(f'<{len(raw)//4}f', raw)
    return m, [f[i:i + 3] for i in range(0, len(f), 3)], json.load(open(os.path.join(d, 'manifest.json')))

def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def unit(a):
    l = math.sqrt(sum(x*x for x in a)) or 1
    return tuple(x/l for x in a)

root = sys.argv[1]
print(f"{'run':<14}{'height':>8}{'stretch%':>9}{'draw-in%':>9}{'folds>20°':>10}{'folds>40°':>10}{'max°':>6}")
for name in sys.argv[2:]:
    m, pos, man = load(os.path.join(root, name))
    idx, weld = m['indices'], m['weld']
    info = man['info'][-1]
    edges = {}
    for t in range(0, len(idx), 3):
        tri = idx[t:t+3]
        n = unit(cross(sub(pos[tri[1]], pos[tri[0]]), sub(pos[tri[2]], pos[tri[0]])))
        for k in range(3):
            a, b = tri[k], tri[(k+1) % 3]
            edges.setdefault((min(a, b), max(a, b)), []).append(n)
    angs = []
    for (a, b), ns in edges.items():
        if len(ns) != 2 or (weld[a] and weld[b]):
            continue
        d = max(-1, min(1, sum(x*y for x, y in zip(*ns))))
        angs.append(math.degrees(math.acos(d)))
    # draw-in: weld points' mean distance from centre vs flat outline
    w = [i for i in range(len(pos)) if weld[i]]
    uv = m['uv']
    r_now = sum(math.hypot(pos[i][0], pos[i][1]) for i in w) / len(w)
    cx = sum(uv[2*i] for i in w) / len(w); cy = sum(uv[2*i+1] for i in w) / len(w)
    span = m['size']
    r_flat = sum(math.hypot(uv[2*i]-cx, uv[2*i+1]-cy) for i in w) / len(w) * span
    pcx = sum(pos[i][0] for i in w)/len(w); pcy = sum(pos[i][1] for i in w)/len(w)
    r_now = sum(math.hypot(pos[i][0]-pcx, pos[i][1]-pcy) for i in w) / len(w)
    n = len(angs)
    print(f"{name:<14}{info['heightMm']:>8.0f}{info['maxStretchPct']:>9.1f}{100*(1-r_now/r_flat):>9.1f}"
          f"{100*sum(a>20 for a in angs)/n:>9.2f}%{100*sum(a>40 for a in angs)/n:>9.2f}%{max(angs):>6.0f}")
