"""Smallest proof-of-life model for OpenCourant: a 300 mm square plate of
0.8 mm 304, edges held, pressure ramped. LS-DYNA keyword format.
Units: mm, s, tonne, N (so MPa)."""
N, L, T = 30, 300.0, 0.8
h = L / N
out = ['*KEYWORD', '*TITLE', 'BlownSim proof of life - pressurised plate',
       '*CONTROL_TERMINATION', '$   endtim', '     0.004',
       '*DATABASE_BINARY_D3PLOT', '$       dt', '    0.0004',
       '*DATABASE_GLSTAT', '    0.0001',
       '*PART', 'plate', '         1         1         1',
       '*SECTION_SHELL', '$    secid    elform      shrf       nip', '         1         2       1.0         5',
       f'{T:10.3f}{T:10.3f}{T:10.3f}{T:10.3f}',
       '*MAT_PIECEWISE_LINEAR_PLASTICITY', '$      mid        ro         e        pr      sigy      etan',
       '         1   7.90e-9  193000.0       0.3     215.0    2000.0',
       '         0.0       0.0         0         0',
       '         0.0       0.0       0.0       0.0       0.0       0.0       0.0       0.0',
       '         0.0       0.0       0.0       0.0       0.0       0.0       0.0       0.0',
       '*NODE']
nid = lambda i, j: j * (N + 1) + i + 1
edge = []
for j in range(N + 1):
    for i in range(N + 1):
        out.append(f'{nid(i, j):8d}{i * h - L / 2:16.4f}{j * h - L / 2:16.4f}{0.0:16.4f}')
        if i in (0, N) or j in (0, N):
            edge.append(nid(i, j))
out.append('*ELEMENT_SHELL')
eid = 0
for j in range(N):
    for i in range(N):
        eid += 1
        out.append(f'{eid:8d}{1:8d}{nid(i, j):8d}{nid(i + 1, j):8d}{nid(i + 1, j + 1):8d}{nid(i, j + 1):8d}')
out += ['*SET_NODE_LIST', '         1']
for k in range(0, len(edge), 8):
    out.append(''.join(f'{n:10d}' for n in edge[k:k + 8]))
out += ['*BOUNDARY_SPC_SET', '         1         0         1         1         1         0         0         0',
        '*SET_SEGMENT', '         1']
for j in range(N):
    for i in range(N):
        out.append(f'{nid(i, j):10d}{nid(i + 1, j):10d}{nid(i + 1, j + 1):10d}{nid(i, j + 1):10d}')
out += ['*LOAD_SEGMENT_SET', '$     ssid      lcid        sf', '         1         1       1.0',
        '*DEFINE_CURVE', '         1', '                 0.0                 0.0',
        '               0.004                 0.5',
        '*END']
open('plate.k', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('plate.k', eid, 'shells')
