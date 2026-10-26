"""Write a KIT-style "Die-Less Hydroforming" model (LS-DYNA keywords) for
OpenCourant from a BlownSim mesh. See docs/REFERENCE_SOLVER.md.

    python reference/kit_deck.py runs/<mesh-run> <out-dir> [--t 0.8] [--volume-l 4]
        [--time 0.05] [--frames 40] [--gap 0.3] [--bulk 2200] [--contact 1]

KIT's recipe, as built here:
- two blanks: BlownSim's top and bottom sheets already share their weld
  points (= KIT's merged edge nodes, the seal weld). Interior points are
  lifted +-(t+gap)/2 so the sheets start just apart; weld points stay at 0;
- shells at real thickness, Belytschko-Tsay, 5 points through the thickness;
- 304 (1.4301) piecewise-linear plasticity, true stress vs plastic strain
  (Ludwik fit 215 + 1275*ep^0.75 MPa until Metzger's DIC curve is in);
- automatic single-surface self-contact;
- inflation by pumping in fluid mass (AIRBAG_LINEAR_FLUID, water); the
  pressure follows from volume and bulk modulus.
Units: mm, s, tonne, N (MPa). Node id = BlownSim vertex index + 1.
"""
import json, os, struct, sys

args = sys.argv[1:]
src, out_dir = args[0], args[1]
opt = {'t': 0.8, 'volume-l': 4.0, 'time': 0.05, 'frames': 40, 'gap': 0.3, 'bulk': 2200.0, 'contact': 1.0,
       # Mass scaling (KIT used time + mass scaling): elements whose stable step
       # is below this get just enough added mass to reach it. 0 = off.
       'dt-min': 8.0e-7}
k = 2
while k < len(args):
    opt[args[k].lstrip('-')] = float(args[k + 1])
    k += 2

m = json.load(open(os.path.join(src, 'mesh.json')))
fr = sorted(os.listdir(os.path.join(src, 'frames')))
raw = open(os.path.join(src, 'frames', fr[0]), 'rb').read()
f = struct.unpack(f'<{len(raw)//4}f', raw)
n = len(f) // 3
idx = m['indices']
tris = [idx[i:i + 3] for i in range(0, len(idx), 3)]
n_top = m['topTriangles']
weld = m['weld']

t = opt['t']
zoff = (t + opt['gap']) / 2
sheet = [None] * n
for ti, tri in enumerate(tris):
    for v in tri:
        if not weld[v]:
            sheet[v] = 0 if ti < n_top else 1

T = opt['time']
lines = ['*KEYWORD', '*TITLE', f'BlownSim reference - KIT die-less hydroforming ({os.path.basename(src)})',
         '*CONTROL_TERMINATION', f'{T:10.5f}',
         '*CONTROL_TIMESTEP', '$   dtinit    tssfac      isdo    tslimt     dt2ms',
         f'{0.0:10.1f}{0.9:10.2f}{0:10d}{0.0:10.1f}{-opt["dt-min"]:10.2e}',
         '*DATABASE_BINARY_D3PLOT', f'{T / opt["frames"]:10.6f}',
         '*DATABASE_GLSTAT', f'{T / 200:10.6f}',
         '*DATABASE_ABSTAT', f'{T / 200:10.6f}',
         '*PART', 'top sheet', '         1         1         1',
         '*PART', 'bottom sheet', '         2         1         1',
         '*SECTION_SHELL', '$    secid    elform      shrf       nip', '         1         2    0.8333         5',
         f'{t:10.4f}{t:10.4f}{t:10.4f}{t:10.4f}',
         '*MAT_PIECEWISE_LINEAR_PLASTICITY', '$      mid        ro         e        pr      sigy      etan',
         '         1   7.90e-9  193000.0       0.3     215.0       0.0',
         '$     fail      tdel         c         p      lcss      lcsr        vp',
         '       0.0       0.0       0.0       0.0         3         0       0.0',
         '       0.0       0.0       0.0       0.0       0.0       0.0       0.0       0.0',
         '       0.0       0.0       0.0       0.0       0.0       0.0       0.0       0.0',
         '*DEFINE_CURVE', '         3', '$ plastic strain, true stress (MPa): 304, Ludwik 215 + 1275*ep^0.75']
for ep in (0.0, 0.002, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.15, 0.2, 0.3, 0.45, 0.6, 1.0):
    lines.append(f'{ep:20.5f}{215 + 1275 * ep ** 0.75:20.3f}')
lines.append('*NODE')
for i in range(n):
    z = 0.0 if sheet[i] is None else (zoff if sheet[i] == 0 else -zoff)
    lines.append(f'{i + 1:8d}{f[3 * i]:16.5f}{f[3 * i + 1]:16.5f}{z:16.5f}')
lines.append('*ELEMENT_SHELL')
for ti, (a, b, c) in enumerate(tris):
    pid = 1 if ti < n_top else 2
    lines.append(f'{ti + 1:8d}{pid:8d}{a + 1:8d}{b + 1:8d}{c + 1:8d}{c + 1:8d}')
lines += ['*SET_PART_LIST', '         1', '         1         2']
if opt['contact'] > 0:
    lines += ['*CONTACT_AUTOMATIC_SINGLE_SURFACE', '$     ssid      msid     sstyp     mstyp',
              '         1         0         2         0',
              '$       fs        fd', '       0.1       0.1',
              '']
# Fluid pumped in: mass rate ramps up smoothly over the first 10 %, then constant,
# so that the total equals the target volume of water.
rho = 1.0e-9
mass = rho * opt['volume-l'] * 1.0e6
rate = mass / (0.95 * T)
lines += ['*AIRBAG_LINEAR_FLUID', '$      sid    sidtyp      rbid      vsca      psca      vini       mwd      spsf',
          '         1         1         0       1.0       1.0       0.0       0.0       0.0',
          '$     bulk        ro     lcint    lcoutt    lcoutp     lcfit    lcbulk      lcid',
          f'{opt["bulk"]:10.1f}{rho:10.2e}         2         0         0         0         0         0',
          '*DEFINE_CURVE', '         2',
          f'{0.0:20.6f}{0.0:20.6e}', f'{0.1 * T:20.6f}{rate:20.6e}', f'{T:20.6f}{rate:20.6e}',
          '*END']
os.makedirs(out_dir, exist_ok=True)
open(os.path.join(out_dir, 'model.k'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
json.dump({'source': src, 'options': opt, 'nodes': n, 'shells': len(tris)}, open(os.path.join(out_dir, 'deck.json'), 'w'), indent=1)
print(f'{out_dir}/model.k: {n} nodes, {len(tris)} shells, t {t} mm, water {opt["volume-l"]} L over {T} s')
