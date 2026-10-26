// STEP (AP214) for CAD: the inflated piece as one closed faceted solid in
// millimetres. Every triangle is a flat face (FACE_SURFACE on a PLANE bounded
// by a POLY_LOOP), the form AP214's faceted_brep_shape_representation asks
// for; the two sheets share their weld points, so the shell is closed.

import { centred, type ExportGeometry } from './files';

const f = (x: number) => {
  const s = x.toFixed(4);
  return s.includes('.') ? s.replace(/0+$/, '') : `${s}.`;
};

export function buildStep(mesh: ExportGeometry, frame: Float32Array, name: string): string {
  const pos = centred(frame);
  const safe = name.replace(/['\\]/g, '');
  const L: string[] = [];
  let id = 0;
  const add = (entity: string) => {
    id += 1;
    L.push(`#${id}=${entity};`);
    return id;
  };

  const app = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app})`);
  const pctx = add(`PRODUCT_CONTEXT('',#${app},'mechanical')`);
  const prod = add(`PRODUCT('${safe}','${safe}','Simflate inflated form',(#${pctx}))`);
  add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${prod}))`);
  const form = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const dctx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`);
  const pdef = add(`PRODUCT_DEFINITION('design','',#${form},#${dctx})`);
  const pshape = add(`PRODUCT_DEFINITION_SHAPE('','',#${pdef})`);
  const mm = add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
  const radian = add('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
  const sr = add('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-04),#${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${mm},#${radian},#${sr})) REPRESENTATION_CONTEXT('','') )`,
  );
  const o = add("CARTESIAN_POINT('',(0.,0.,0.))");
  const z = add("DIRECTION('',(0.,0.,1.))");
  const x = add("DIRECTION('',(1.,0.,0.))");
  const axis = add(`AXIS2_PLACEMENT_3D('',#${o},#${z},#${x})`);

  // One point per watertight original (the smooth mesh splits points at UV seams).
  const n = pos.length / 3;
  const pointOf = new Int32Array(n);
  const byOrigin = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const key = mesh.origin ? mesh.origin[i] : i;
    let p = byOrigin.get(key);
    if (p === undefined) {
      p = add(`CARTESIAN_POINT('',(${f(pos[i * 3])},${f(pos[i * 3 + 1])},${f(pos[i * 3 + 2])}))`);
      byOrigin.set(key, p);
    }
    pointOf[i] = p;
  }

  const faces: number[] = [];
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const pa = pointOf[a], pb = pointOf[b], pc = pointOf[c];
    if (pa === pb || pb === pc || pa === pc) continue;
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-12)) continue; // degenerate sliver
    nx /= l;
    ny /= l;
    nz /= l;
    const dir = add(`DIRECTION('',(${nx.toFixed(6)},${ny.toFixed(6)},${nz.toFixed(6)}))`);
    const place = add(`AXIS2_PLACEMENT_3D('',#${pa},#${dir},$)`);
    const plane = add(`PLANE('',#${place})`);
    const loop = add(`POLY_LOOP('',(#${pa},#${pb},#${pc}))`);
    const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    faces.push(add(`FACE_SURFACE('',(#${bound}),#${plane},.T.)`));
  }
  const shell = add(`CLOSED_SHELL('',(${faces.map((k) => `#${k}`).join(',')}))`);
  const brep = add(`FACETED_BREP('${safe}',#${shell})`);
  const rep = add(`FACETED_BREP_SHAPE_REPRESENTATION('',(#${brep},#${axis}),#${ctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(#${pshape},#${rep})`);

  const now = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('Simflate inflated form, faceted solid, millimetres'),'2;1');",
    `FILE_NAME('${safe}.step','${now}',(''),(''),'Simflate','Simflate','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...L,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
