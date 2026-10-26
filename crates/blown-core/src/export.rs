//! Mesh writers: OBJ + MTL (KeyShot), binary STL, and raw frame data.
//!
//! Parts follow the spec: Sheet_Top, Sheet_Bottom (and Weld_Fillet once the
//! finisher exists), materials Stainless_Main / Stainless_Weld, millimetres,
//! centred on the origin.

use std::io::{self, Write};

use crate::mesh::SheetMesh;

pub const PART_NAMES: [&str; 2] = ["Sheet_Top", "Sheet_Bottom"];
pub const MAIN_MATERIAL: &str = "Stainless_Main";
pub const WELD_MATERIAL: &str = "Stainless_Weld";

/// Area-weighted vertex normals.
pub fn vertex_normals(pos: &[[f64; 3]], tris: &[[u32; 3]]) -> Vec<[f64; 3]> {
    let mut n = vec![[0.0; 3]; pos.len()];
    for t in tris {
        let (a, b, c) = (pos[t[0] as usize], pos[t[1] as usize], pos[t[2] as usize]);
        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        for &i in t {
            for k in 0..3 {
                n[i as usize][k] += f[k];
            }
        }
    }
    for v in n.iter_mut() {
        let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        if l > 0.0 {
            for k in 0..3 {
                v[k] /= l;
            }
        }
    }
    n
}

/// UVs from the flat cut pattern, 0–1 across the longer side.
pub fn flat_uvs(mesh: &SheetMesh) -> Vec<[f64; 2]> {
    let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
    for p in &mesh.flat {
        for k in 0..2 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    let span = (hi[0] - lo[0]).max(hi[1] - lo[1]).max(1e-9);
    mesh.flat.iter().map(|p| [(p[0] - lo[0]) / span, (p[1] - lo[1]) / span]).collect()
}

/// Write an OBJ. `pos` must be in mm and already centred.
pub fn write_obj(out: &mut impl Write, mesh: &SheetMesh, pos: &[[f64; 3]], mtl_file: Option<&str>) -> io::Result<()> {
    writeln!(out, "# BlownSim export — units: millimetres")?;
    if let Some(m) = mtl_file {
        writeln!(out, "mtllib {m}")?;
    }
    for p in pos {
        writeln!(out, "v {:.5} {:.5} {:.5}", p[0], p[1], p[2])?;
    }
    for uv in flat_uvs(mesh) {
        writeln!(out, "vt {:.6} {:.6}", uv[0], uv[1])?;
    }
    for n in vertex_normals(pos, &mesh.tris) {
        writeln!(out, "vn {:.5} {:.5} {:.5}", n[0], n[1], n[2])?;
    }
    for (sheet, name) in PART_NAMES.iter().enumerate() {
        writeln!(out, "o {name}")?;
        writeln!(out, "g {name}")?;
        writeln!(out, "usemtl {MAIN_MATERIAL}")?;
        writeln!(out, "s 1")?;
        for (t, s) in mesh.tris.iter().zip(&mesh.tri_sheet) {
            if *s as usize == sheet {
                let (a, b, c) = (t[0] + 1, t[1] + 1, t[2] + 1);
                writeln!(out, "f {a}/{a}/{a} {b}/{b}/{b} {c}/{c}/{c}")?;
            }
        }
    }
    Ok(())
}

pub fn write_mtl(out: &mut impl Write) -> io::Result<()> {
    writeln!(out, "# BlownSim materials — restyle in KeyShot by material name")?;
    for (name, rough) in [(MAIN_MATERIAL, 0.15), (WELD_MATERIAL, 0.3)] {
        writeln!(out, "newmtl {name}")?;
        writeln!(out, "Ka 0.0 0.0 0.0")?;
        writeln!(out, "Kd 0.55 0.56 0.58")?;
        writeln!(out, "Ks 0.9 0.9 0.9")?;
        writeln!(out, "Ns 400")?;
        writeln!(out, "Pm 1.0")?;
        writeln!(out, "Pr {rough}")?;
        writeln!(out, "illum 3\n")?;
    }
    Ok(())
}

/// Binary STL (no parts or UVs).
pub fn write_stl(out: &mut impl Write, mesh: &SheetMesh, pos: &[[f64; 3]]) -> io::Result<()> {
    let mut header = [0u8; 80];
    let tag = b"BlownSim STL (mm)";
    header[..tag.len()].copy_from_slice(tag);
    out.write_all(&header)?;
    out.write_all(&(mesh.tris.len() as u32).to_le_bytes())?;
    for t in &mesh.tris {
        let (a, b, c) = (pos[t[0] as usize], pos[t[1] as usize], pos[t[2] as usize]);
        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let mut n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let l = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt().max(1e-30);
        n.iter_mut().for_each(|x| *x /= l);
        for p in [n, a, b, c] {
            for x in p {
                out.write_all(&(x as f32).to_le_bytes())?;
            }
        }
        out.write_all(&[0, 0])?;
    }
    Ok(())
}

/// Raw little-endian f32 positions (one frame).
pub fn write_frame(out: &mut impl Write, positions: &[f32]) -> io::Result<()> {
    let mut buf = Vec::with_capacity(positions.len() * 4);
    for x in positions {
        buf.extend_from_slice(&x.to_le_bytes());
    }
    out.write_all(&buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::{triangulate, SheetMesh};
    use crate::shapes;

    #[test]
    fn obj_has_both_parts() {
        let flat = triangulate(&[shapes::circle(100.0)], 200.0, 28.0).unwrap();
        let mesh = SheetMesh::from_flat(&flat);
        let pos: Vec<[f64; 3]> = mesh.flat.iter().map(|p| [p[0], p[1], 0.0]).collect();
        let mut buf = Vec::new();
        write_obj(&mut buf, &mesh, &pos, Some("x.mtl")).unwrap();
        let s = String::from_utf8(buf).unwrap();
        assert!(s.contains("o Sheet_Top") && s.contains("o Sheet_Bottom") && s.contains("usemtl Stainless_Main"));
        assert_eq!(s.lines().filter(|l| l.starts_with("f ")).count(), mesh.tris.len());
    }
}
