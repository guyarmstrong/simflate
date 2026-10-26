//! blown-cli — run BlownSim headless and save every frame for the viewer.
//!
//!   blown-cli run --shape circle --size 300 --pressure 70 --character 0.3 \
//!                 [--plates 40] [--height 80] [--seed 1] [--soap] [--final] [--symmetric] [--mesh-only] [--geometric --waves 1 --wave-depth 0.5] --name my-run
//!   blown-cli run --pieces outline.json --name my-run        (pieces in mm, see Piece)
//!   blown-cli suite                                           (the Phase 0 test set)
//!   blown-cli ref-deck <mesh-run> <out-dir> [--t 0.8] [--volume-l 4] [--time 0.05] [--frames 40] [--plan]
//!                                                             (reference model, like reference/kit_deck.py)
//!   blown-cli ref-water <ref-dir>                             (water pressure through a reference run)
//!   blown-cli ref-run <mesh-run> --oc <OpenCourant folder> --name <run> [--root <project>] [--t 0.8] [--pressure 70 | --height 80]
//!                 [--character 0.5] [--waves 3] [--volume-l 4 --time 0.08 --frames 40] [--imperfection 0.5 --seed 1]
//!                 [--prepare]   (only prepare the model, as the app does in the background)
//!                                                             (the app's Reference solver: ref/<run> -> runs/<run>)
//!
//! Output goes to runs/<name>/: mesh.json, frames/NNNNN.bin, manifest.json,
//! and when finished <name>.obj/.mtl/.stl plus a settings sidecar.

use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::time::Instant;

use blown_core::export::{flat_uvs, write_frame, write_mtl, write_obj, write_stl};
use blown_core::mesh::VertexKind;
use blown_core::finish::{FinishParams, RenderMesh};
use blown_core::{shapes, Material, Tuning, MeshQuality, Piece, PlateSettings, Sim, SimSettings, Status};
use serde_json::json;

struct RunArgs {
    name: String,
    shape: String,
    size: f64,
    pieces_file: Option<PathBuf>,
    settings: SimSettings,
    out_dir: PathBuf,
    tuning: Tuning,
    /// Also save a smoothed copy (finisher) as run "<name>~smooth".
    finish: Option<FinishParams>,
    /// Pressure steps after the first: settle, then raise to the next.
    stages: Vec<f64>,
    /// Write the mesh and the flat first frame only (for ref-run).
    mesh_only: bool,
}

fn usage() -> ! {
    eprintln!(
        "usage:\n  blown-cli run --shape circle|square|lshape|surfboard|ring|hexagon --size 300 \\\n      --pressure 70 --character 0.3 [--plates 40] [--offset 0] [--height 80] [--seed 1] \\\n      [--randomness 0.5] [--friction 0.05] [--bottom 1] [--soap] [--final] [--out runs] \
      [--tune constant=value …] --name <run>\n  blown-cli run --pieces outline.json --name <run>\n  blown-cli suite [--out runs]"
    );
    std::process::exit(2)
}

fn parse_run(args: &[String]) -> RunArgs {
    let mut r = RunArgs {
        name: String::new(),
        shape: "circle".into(),
        size: 300.0,
        pieces_file: None,
        settings: SimSettings::default(),
        out_dir: PathBuf::from("runs"),
        tuning: Tuning::default(),
        finish: None,
        stages: Vec::new(),
        mesh_only: false,
    };
    let mut plate_thickness: Option<f64> = None;
    let mut plate_offset = 0.0;
    let mut i = 0;
    let num = |v: Option<&String>, flag: &str| -> f64 {
        v.and_then(|s| s.parse().ok()).unwrap_or_else(|| {
            eprintln!("{flag} needs a number");
            usage()
        })
    };
    while i < args.len() {
        let a = args[i].as_str();
        let v = args.get(i + 1);
        match a {
            "--name" => r.name = v.cloned().unwrap_or_else(|| usage()),
            "--stages" => {
                // e.g. 50,62,74: start at 50, settle, raise to 62, settle, … (the app's slider path)
                let list: Vec<f64> = v.map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect()).unwrap_or_default();
                if list.is_empty() {
                    usage();
                }
                r.settings.pressure = list[0];
                r.stages = list[1..].to_vec();
            }
            "--shape" => r.shape = v.cloned().unwrap_or_else(|| usage()),
            "--pieces" => r.pieces_file = Some(PathBuf::from(v.cloned().unwrap_or_else(|| usage()))),
            "--out" => r.out_dir = PathBuf::from(v.cloned().unwrap_or_else(|| usage())),
            "--size" => r.size = num(v, a),
            "--pressure" => r.settings.pressure = num(v, a),
            "--character" => r.settings.character = num(v, a),
            "--thickness" => r.settings.thickness_mm = num(v, a),
            "--hold" => r.settings.crease_hold = num(v, a),
            "--plates" => plate_thickness = Some(num(v, a)),
            "--offset" => plate_offset = num(v, a),
            "--height" => r.settings.target_height_mm = Some(num(v, a)),
            "--seed" => r.settings.seed = num(v, a) as u64,
            "--randomness" => r.settings.crease_randomness = num(v, a),
            "--ripples" => r.settings.edge_ripples = num(v, a),
            "--fillet" => r.settings.weld_fillet_mm = num(v, a),
            "--friction" => r.settings.plate_friction = num(v, a),
            "--seam" => r.settings.seam_stiffness = num(v, a),
            "--bottom" => r.settings.bottom_stiffness = num(v, a),
            "--tune" => {
                let kv = v.cloned().unwrap_or_else(|| usage());
                let (k, val) = kv.split_once('=').unwrap_or_else(|| usage());
                let val: f64 = val.parse().unwrap_or_else(|_| usage());
                if !r.tuning.set(k, val) {
                    eprintln!("unknown tuning constant {k}");
                    usage()
                }
            }
            "--fix-outline" => {
                r.settings.fix_outline = true;
                i += 1;
                continue;
            }
            "--geometric" => {
                r.settings.geometric = true;
                i += 1;
                continue;
            }
            "--waves" => r.settings.waves_per_edge = num(v, a) as u32,
            "--wave-depth" => r.settings.wave_depth = num(v, a),
            "--tuck-width" => r.settings.tuck_width = num(v, a),
            "--tuck-length" => r.settings.tuck_length = num(v, a),
            "--corner-fade" => r.settings.corner_fade = num(v, a),
            "--tuck-scaling" => r.settings.tuck_scaling = num(v, a),
            "--edge-pull" => r.settings.edge_pull = num(v, a),
            "--edge-lift" => r.settings.edge_lift = num(v, a),
            "--tuck-shape" => r.settings.tuck_shape = num(v, a),
            "--edge-smooth" => r.settings.edge_smooth = num(v, a),
            "--side-wall" => r.settings.side_wall = num(v, a),
            "--tuck-width-mm" => r.settings.tuck_width_mm = Some(num(v, a)),
            "--tuck-length-mm" => r.settings.tuck_length_mm = Some(num(v, a)),
            "--valley-depth-mm" => r.settings.valley_depth_mm = Some(num(v, a)),
            "--tuck-random" => r.settings.tuck_randomness = num(v, a),
            "--tuck-taper" => r.settings.tuck_taper = num(v, a),
            "--round" => {
                r.settings.round_mode = match v.map(|s| s.as_str()).unwrap_or_else(|| usage()) {
                    "on" | "round" => blown_core::settings::RoundMode::Round,
                    "off" | "corners" => blown_core::settings::RoundMode::Corners,
                    _ => blown_core::settings::RoundMode::Auto,
                }
            }
            "--fold-over" => r.settings.fold_over = num(v, a),
            "--min-bend-mm" => r.settings.min_bend_mm = num(v, a),
            "--symmetric" => {
                r.settings.symmetric = true;
                i += 1;
                continue;
            }
            "--mesh-only" => {
                r.mesh_only = true;
                i += 1;
                continue;
            }
            "--steel" => {
                r.settings.steel_solver = true;
                i += 1;
                continue;
            }
            "--soap" => {
                r.settings.material = Material::Soap;
                i += 1;
                continue;
            }
            "--finish" => {
                let levels = num(v, a) as u32;
                r.finish.get_or_insert_with(FinishParams::default).levels = levels;
            }
            "--pre-smooth" => {
                let f = r.finish.get_or_insert_with(FinishParams::default);
                f.pre_smooth_iterations = num(v, a) as u32;
            }
            "--ridges" => {
                let f = r.finish.get_or_insert_with(FinishParams::default);
                f.ridge_sharpness = num(v, a);
            }
            "--ridge-min-deg" => {
                let f = r.finish.get_or_insert_with(FinishParams::default);
                f.ridge_min_deg = num(v, a);
            }
            "--ridge-min-len" => {
                let f = r.finish.get_or_insert_with(FinishParams::default);
                f.ridge_min_len_mm = num(v, a);
            }
            "--crease-angle" => {
                let f = r.finish.get_or_insert_with(FinishParams::default);
                f.crease_angle_deg = num(v, a);
            }
            "--medium" => {
                r.settings.quality = MeshQuality::Medium;
                i += 1;
                continue;
            }
            "--xfine" => {
                r.settings.quality = MeshQuality::XFine;
                i += 1;
                continue;
            }
            "--final" => {
                r.settings.quality = MeshQuality::Final;
                i += 1;
                continue;
            }
            _ => {
                eprintln!("unknown option {a}");
                usage()
            }
        }
        i += 2;
    }
    if let Some(t) = plate_thickness {
        r.settings.plates = Some(PlateSettings { thickness_mm: t, offset_mm: plate_offset });
    }
    if r.name.is_empty() {
        r.name = format!("{}-{}", r.shape, r.settings.seed);
    }
    r
}

fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data)?;
    fs::rename(&tmp, path)
}

fn run(r: &RunArgs) -> Result<(), String> {
    let pieces: Vec<Piece> = match &r.pieces_file {
        Some(p) => {
            let text = fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?;
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))?
        }
        None => vec![shapes::by_name(&r.shape, r.size).ok_or_else(|| format!("unknown shape '{}'", r.shape))?],
    };

    let dir = r.out_dir.join(&r.name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dir.join("frames")).map_err(|e| e.to_string())?;

    let t0 = Instant::now();
    let mut sim = Sim::with_tuning(&pieces, r.settings.clone(), r.tuning.clone())?;
    let mesh = &sim.mesh;
    let indices: Vec<u32> = mesh.tris.iter().flatten().copied().collect();
    let top_tris = mesh.tri_sheet.iter().filter(|s| **s == 0).count();
    let uv: Vec<f32> = flat_uvs(mesh).iter().flat_map(|p| [p[0] as f32, p[1] as f32]).collect();
    let weld: Vec<u8> = mesh.kind.iter().map(|k| (*k == VertexKind::Weld) as u8).collect();
    let outline: Vec<&Vec<[f64; 2]>> = pieces.iter().flat_map(|p| std::iter::once(&p.outer).chain(&p.holes)).collect();
    let mesh_json = json!({
        "name": r.name,
        "units": "mm",
        "vertexCount": mesh.num_vertices(),
        "indices": indices,
        "topTriangles": top_tris,
        "uv": uv,
        "weld": weld,
        "outline": outline,
        "settings": r.settings,
        "shape": if r.pieces_file.is_some() { "custom".to_string() } else { r.shape.clone() },
        "size": r.size,
    });
    write_atomic(&dir.join("mesh.json"), mesh_json.to_string().as_bytes()).map_err(|e| e.to_string())?;
    eprintln!(
        "[{}] {} points, {} triangles, meshed in {:.2}s",
        r.name,
        mesh.num_vertices(),
        mesh.tris.len(),
        t0.elapsed().as_secs_f64()
    );
    for w in &mesh.warnings {
        eprintln!("  warning: {w}");
    }

    let mut infos = Vec::new();
    let mut buf = Vec::new();
    let mut frame_no = 0u32;
    let save = |sim: &Sim, frame_no: u32, buf: &mut Vec<f32>| -> Result<(), String> {
        sim.positions_mm(buf);
        let mut f = BufWriter::new(fs::File::create(dir.join("frames").join(format!("{frame_no:05}.bin"))).map_err(|e| e.to_string())?);
        write_frame(&mut f, buf).map_err(|e| e.to_string())
    };
    save(&sim, frame_no, &mut buf)?;
    infos.push(sim.info());
    if r.mesh_only {
        let manifest = json!({ "name": r.name, "frames": 1, "done": true, "info": infos });
        write_atomic(&dir.join("manifest.json"), manifest.to_string().as_bytes()).map_err(|e| e.to_string())?;
        eprintln!("[{}] mesh only → {}", r.name, dir.display());
        return Ok(());
    }
    let mut stage = 0;
    let mut solve_time = std::time::Duration::ZERO;
    loop {
        let t0 = std::time::Instant::now();
        let info = sim.step_frame();
        solve_time += t0.elapsed();
        frame_no += 1;
        save(&sim, frame_no, &mut buf)?;
        infos.push(info.clone());
        let mut done = info.status == Status::Settled;
        if done && stage < r.stages.len() {
            eprintln!("  frame {:4}  settled at pressure {:.1} → raising to {}", info.frame, info.pressure, r.stages[stage]);
            sim.raise_pressure(r.stages[stage]);
            stage += 1;
            done = false;
        }
        let manifest = json!({ "name": r.name, "frames": frame_no + 1, "done": done, "info": infos });
        write_atomic(&dir.join("manifest.json"), manifest.to_string().as_bytes()).map_err(|e| e.to_string())?;
        if frame_no % 10 == 0 || done {
            eprintln!(
                "  frame {:4}  pressure {:5.1}  height {:7.1} mm  stretch {:4.1}%  contact {:4.0}%  motion {:.1e}",
                info.frame,
                info.pressure,
                info.height_mm,
                info.max_stretch_pct,
                info.contact_fraction * 100.0,
                info.motion
            );
        }
        if done {
            break;
        }
    }
    eprintln!("  solver {:.1} ms/frame", solve_time.as_secs_f64() * 1000.0 / frame_no.max(1) as f64);

    if let Some(fp) = &r.finish {
        write_smooth_run(r, &sim, fp)?;
    }

    // BS_CORNERS=1: report how sharp corners held up (tip draw-in, width
    // kept near the tip, height near the tip) — for tuning `corner_*`.
    if std::env::var("BS_CORNERS").is_ok() {
        let pm = sim.positions_f64_mm();
        for p in &pieces {
            let o = &p.outer;
            let m = o.len();
            for k in 0..m {
                let (a, b, c) = (o[(k + m - 1) % m], o[k], o[(k + 1) % m]);
                let (u, v) = ([a[0] - b[0], a[1] - b[1]], [c[0] - b[0], c[1] - b[1]]);
                let ang = ((u[0] * v[0] + u[1] * v[1]) / ((u[0].hypot(u[1])) * (v[0].hypot(v[1])))).acos().to_degrees();
                if ang > 120.0 {
                    continue;
                }
                let near = (0..pm.len()).min_by(|&i, &j| {
                    let d = |i: usize| (sim.mesh.flat[i][0] - b[0]).hypot(sim.mesh.flat[i][1] - b[1]);
                    d(i).partial_cmp(&d(j)).unwrap()
                }).unwrap();
                let pull = (pm[near][0] - b[0]).hypot(pm[near][1] - b[1]);
                let zat = |r: f64| pm.iter().zip(&sim.mesh.flat).filter(|(_, f)| (f[0] - b[0]).hypot(f[1] - b[1]) < r).map(|(q, _)| q[2].abs()).fold(0.0, f64::max);
                let at = |q: [f64; 2]| (0..pm.len()).filter(|&i| sim.mesh.kind[i] == VertexKind::Weld).min_by(|&i, &j| {
                    let d = |i: usize| (sim.mesh.flat[i][0] - q[0]).hypot(sim.mesh.flat[i][1] - q[1]);
                    d(i).partial_cmp(&d(j)).unwrap()
                }).unwrap();
                let (lu, lv) = (u[0].hypot(u[1]), v[0].hypot(v[1]));
                let mut widths = String::new();
                for s in [20.0, 40.0, 80.0] {
                    let (i, j) = (at([b[0] + u[0] / lu * s, b[1] + u[1] / lu * s]), at([b[0] + v[0] / lv * s, b[1] + v[1] / lv * s]));
                    let w0 = (sim.mesh.flat[i][0] - sim.mesh.flat[j][0]).hypot(sim.mesh.flat[i][1] - sim.mesh.flat[j][1]);
                    let w1 = (pm[i][0] - pm[j][0]).hypot(pm[i][1] - pm[j][1]);
                    widths += &format!(" {:.0}%", 100.0 * w1 / w0);
                }
                eprintln!("CORNER width kept at 20/40/80 mm:{widths}");
                eprintln!("CORNER {:.0}° at ({:.0},{:.0}): tip pulled in {:.1} mm; height within 10/20/40 mm of tip {:.1}/{:.1}/{:.1}", ang, b[0], b[1], pull, zat(10.0), zat(20.0), zat(40.0));
            }
        }
    }

    // Final mesh, centred on the origin.
    let mut pos = sim.positions_f64_mm();
    for p in pos.iter_mut() {
        p[0] -= sim.center[0];
        p[1] -= sim.center[1];
    }
    let obj_name = format!("{}.obj", r.name);
    let mtl_name = format!("{}.mtl", r.name);
    let mut f = BufWriter::new(fs::File::create(dir.join(&obj_name)).map_err(|e| e.to_string())?);
    write_obj(&mut f, &sim.mesh, &pos, Some(&mtl_name)).map_err(|e| e.to_string())?;
    let mut f = BufWriter::new(fs::File::create(dir.join(&mtl_name)).map_err(|e| e.to_string())?);
    write_mtl(&mut f).map_err(|e| e.to_string())?;
    let mut f = BufWriter::new(fs::File::create(dir.join(format!("{}.stl", r.name))).map_err(|e| e.to_string())?);
    write_stl(&mut f, &sim.mesh, &pos).map_err(|e| e.to_string())?;
    let sidecar = json!({ "app": "BlownSim", "version": env!("CARGO_PKG_VERSION"), "settings": sim.settings, "pieces": pieces, "result": infos.last() });
    fs::write(dir.join(format!("{}.json", r.name)), serde_json::to_string_pretty(&sidecar).unwrap()).map_err(|e| e.to_string())?;
    eprintln!("[{}] done in {:.1}s → {}", r.name, t0.elapsed().as_secs_f64(), dir.display());
    Ok(())
}

/// Save the finisher's render mesh of the last frame as its own one-frame run.
fn write_smooth_run(r: &RunArgs, sim: &Sim, fp: &FinishParams) -> Result<(), String> {
    let name = format!("{}~smooth", r.name);
    let dir = r.out_dir.join(&name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dir.join("frames")).map_err(|e| e.to_string())?;
    let fp = sim.finish_params(*fp);
    eprintln!("[{}] sheet ≈ {:.2} mm, edge ripples every {:.0} mm", r.name, sim.thickness_mm(), fp.ripple_wavelength_mm);
    let finished = RenderMesh::from_sim(&sim.mesh, &sim.positions_f64_mm()).finish(&fp);
    let (split, _) = finished.split_sheets();
    let indices: Vec<u32> = split.tris.iter().flatten().copied().collect();
    let top = split.tri_sheet.iter().filter(|s| **s == 0).count();
    let weld: Vec<u8> = split.weld.iter().map(|w| *w as u8).collect();
    let uv: Vec<f32> = split.flat.iter().flat_map(|p| [p[0] as f32 / 1000.0, p[1] as f32 / 1000.0]).collect();
    let mesh_json = json!({ "name": name, "units": "mm", "vertexCount": split.pos.len(), "indices": indices, "topTriangles": top, "uv": uv, "weld": weld, "outline": [], "settings": r.settings });
    fs::write(dir.join("mesh.json"), mesh_json.to_string()).map_err(|e| e.to_string())?;
    let pos: Vec<f32> = split.pos.iter().flat_map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect();
    let mut f = BufWriter::new(fs::File::create(dir.join("frames").join("00000.bin")).map_err(|e| e.to_string())?);
    write_frame(&mut f, &pos).map_err(|e| e.to_string())?;
    drop(f);
    let manifest = json!({ "name": name, "frames": 1, "done": true, "info": [sim.info()] });
    fs::write(dir.join("manifest.json"), manifest.to_string()).map_err(|e| e.to_string())?;
    eprintln!("[{}] smoothed copy: {} triangles → {}", r.name, split.tris.len(), dir.display());
    Ok(())
}

fn suite(out: &Path) -> Result<(), String> {
    let base = |name: &str, shape: &str, size: f64| RunArgs {
        name: name.into(),
        shape: shape.into(),
        size,
        pieces_file: None,
        settings: SimSettings::default(),
        out_dir: out.to_path_buf(),
        tuning: Tuning::default(),
        finish: None,
        stages: Vec::new(),
        mesh_only: false,
    };
    let mut runs = Vec::new();
    for shape in ["circle", "square", "lshape"] {
        runs.push(base(&format!("{shape}-free"), shape, 300.0));
    }
    let mut r = base("surfboard-free", "surfboard", 600.0);
    r.settings.pressure = 84.0; // = 60 on the old straight scale
    runs.push(r);
    for (shape, size, gap) in [("circle", 300.0, 40.0), ("surfboard", 600.0, 40.0)] {
        let mut r = base(&format!("{shape}-plates"), shape, size);
        r.settings.pressure = 100.0;
        r.settings.character = 0.1;
        r.settings.plates = Some(PlateSettings { thickness_mm: gap, offset_mm: 0.0 });
        runs.push(r);
    }
    for (name, c, p) in [("square-balloon", 0.0, 100.0), ("square-geometric", 1.0, 84.0)] {
        let mut r = base(name, "square", 300.0);
        r.settings.character = c;
        r.settings.pressure = p;
        runs.push(r);
    }
    for r in &runs {
        run(r)?;
    }
    Ok(())
}

/// A saved run's mesh and its first (flat) frame: (mesh.json, positions, indices, weld, top triangles).
fn load_mesh_run(src: &Path) -> Result<(serde_json::Value, Vec<f32>, Vec<u32>, Vec<u8>, usize), String> {
    let mesh: serde_json::Value = serde_json::from_str(&fs::read_to_string(src.join("mesh.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut frames: Vec<_> = fs::read_dir(src.join("frames")).map_err(|e| e.to_string())?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    frames.sort();
    let raw = fs::read(frames.first().ok_or("no frames")?).map_err(|e| e.to_string())?;
    let pos: Vec<f32> = raw.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    let indices: Vec<u32> = mesh["indices"].as_array().ok_or("no indices")?.iter().map(|v| v.as_u64().unwrap_or(0) as u32).collect();
    let weld: Vec<u8> = mesh["weld"].as_array().ok_or("no weld")?.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect();
    let top = mesh["topTriangles"].as_u64().ok_or("no topTriangles")? as usize;
    Ok((mesh, pos, indices, weld, top))
}

/// Write a reference model from a saved run's mesh (frame 0).
fn ref_deck(args: &[String]) -> Result<(), String> {
    use blown_core::reference::{deck, flat_area, plan, RefOptions};
    let (src, out) = match args {
        [a, b, ..] => (PathBuf::from(a), PathBuf::from(b)),
        _ => usage(),
    };
    let (_, pos, indices, weld, top) = load_mesh_run(&src)?;
    let mut o = RefOptions::default();
    let mut k = 2;
    while k < args.len() {
        let key = args[k].as_str();
        if key == "--plan" {
            let t = o.thickness_mm;
            o = plan(flat_area(&pos, &indices, top), t);
            k += 1;
            continue;
        }
        let v: f64 = args.get(k + 1).and_then(|v| v.parse().ok()).unwrap_or_else(|| usage());
        match key {
            "--t" => o.thickness_mm = v,
            "--volume-l" => o.volume_l = v,
            "--time" => o.time_s = v,
            "--frames" => o.frames = v as u32,
            "--gap" => o.gap_mm = v,
            "--bulk" => o.bulk_mpa = v,
            "--contact" => o.contact = v > 0.0,
            "--dt-min" => o.dt_min = v,
            "--imperfection" => o.imperfection_mm = v,
            "--seed" => o.seed = v as u64,
            _ => usage(),
        }
        k += 2;
    }
    let title = src.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    fs::write(out.join("model.k"), deck(&title, &pos, &indices, &weld, top, &o)).map_err(|e| e.to_string())?;
    let info = json!({
        "source": src.to_string_lossy().replace('\\', "/"),
        "options": { "t": o.thickness_mm, "volume-l": o.volume_l, "time": o.time_s, "frames": o.frames, "gap": o.gap_mm,
                     "bulk": o.bulk_mpa, "contact": if o.contact { 1.0 } else { 0.0 }, "dt-min": o.dt_min },
        "nodes": pos.len() / 3, "shells": indices.len() / 3,
    });
    fs::write(out.join("deck.json"), serde_json::to_string_pretty(&info).unwrap()).map_err(|e| e.to_string())?;
    println!("{}/model.k: {} nodes, {} shells, t {} mm, water {:.2} L over {:.3} s", out.display(), pos.len() / 3, indices.len() / 3, o.thickness_mm, o.volume_l, o.time_s);
    Ok(())
}

/// Run the Reference solver exactly as the app does, from a saved run's mesh.
/// The OpenCourant job goes in ref/<name>; frames land in runs/<name> as they
/// come (Snapshots -> Test runs can watch it).
fn ref_run(args: &[String]) -> Result<(), String> {
    let mut root = PathBuf::from(".");
    if let Some(i) = args.iter().position(|a| a == "--root") {
        root = PathBuf::from(args.get(i + 1).unwrap_or_else(|| usage()));
    }
    let src = root.join(args.first().unwrap_or_else(|| usage()));
    let (mesh, positions, indices, weld, top_triangles) = load_mesh_run(&src)?;
    let settings = &mesh["settings"];
    let mut name = String::new();
    let mut oc = blown_ref::install_dir();
    let mut thickness = settings["thicknessMm"].as_f64().unwrap_or(0.8);
    let mut character = settings["character"].as_f64().unwrap_or(0.5);
    let mut pressure = settings["pressure"].as_f64().unwrap_or(70.0);
    let mut height = None;
    let mut waves = settings["wavesPerEdge"].as_u64().unwrap_or(0) as u32;
    let mut over: Vec<(String, f64)> = Vec::new();
    let prepare_only = args.iter().any(|a| a == "--prepare");
    let args: Vec<String> = args.iter().filter(|a| *a != "--prepare").cloned().collect();
    let mut k = 1;
    while k < args.len() {
        let v = args.get(k + 1).cloned().unwrap_or_else(|| usage());
        let num = || v.parse::<f64>().unwrap_or_else(|_| usage());
        match args[k].as_str() {
            "--root" => {}
            "--name" => name = v.clone(),
            "--oc" => oc = Some(PathBuf::from(&v)),
            "--t" => thickness = num(),
            "--character" => character = num(),
            "--pressure" => pressure = num(),
            "--height" => height = Some(num()),
            "--waves" => waves = num() as u32,
            "--volume-l" | "--time" | "--frames" | "--imperfection" | "--seed" => over.push((args[k].clone(), num())),
            _ => usage(),
        }
        k += 2;
    }
    if name.is_empty() {
        usage();
    }
    let oc = oc.ok_or("OpenCourant not found: pass --oc <folder>")?;
    let area = blown_core::reference::flat_area(&positions, &indices, top_triangles);
    let mut opts = blown_core::reference::plan(area, thickness);
    for (key, v) in &over {
        match key.as_str() {
            "--volume-l" => opts.volume_l = *v,
            "--time" => opts.time_s = *v,
            "--frames" => opts.frames = *v as u32,
            "--imperfection" => opts.imperfection_mm = *v,
            _ => opts.seed = *v as u64,
        }
    }
    let job = blown_ref::Job {
        oc,
        dir: root.join("ref").join(&name),
        positions,
        indices,
        weld,
        top_triangles,
        thickness_mm: thickness,
        character,
        pressure,
        target_height_mm: height,
        options: Some(opts.clone()),
        symmetric: settings["symmetric"].as_bool().unwrap_or(false),
        waves_per_edge: waves,
        prepared: Some(root.join("ref").join("prepared")),
    };
    if prepare_only {
        let job = blown_ref::Job { dir: root.join("ref").join(format!("{name}-prepare")), ..job };
        let t = std::time::Instant::now();
        let fresh = blown_ref::prepare(&job)?;
        eprintln!("[{name}] {} in {:.1} s", if fresh { "prepared" } else { "already prepared" }, t.elapsed().as_secs_f64());
        return Ok(());
    }
    let ctl = blown_ref::Control::default();
    let target = blown_ref::target_for(&job);
    *ctl.target.lock().unwrap() = target;
    eprintln!(
        "[{name}] {} points, t {thickness} mm, water up to {:.2} L over {:.3} s; stop at {}",
        job.positions.len() / 3,
        opts.volume_l,
        opts.time_s,
        match (target.pressure_mpa, target.height_mm) {
            (Some(p), _) => format!("{:.3} bar (slider {pressure})", p * 10.0),
            (_, Some(h)) => format!("{h} mm high"),
            _ => "the end".into(),
        }
    );

    let dir = root.join("runs").join(&name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dir.join("frames")).map_err(|e| e.to_string())?;
    let mut m2 = mesh.clone();
    m2["name"] = json!(name);
    m2["shape"] = json!(format!("{} (reference)", mesh["shape"].as_str().unwrap_or("custom")));
    m2["reference"] = json!({ "source": src.to_string_lossy().replace('\\', "/"), "thicknessMm": thickness, "volumeL": opts.volume_l, "timeS": opts.time_s });
    write_atomic(&dir.join("mesh.json"), m2.to_string().as_bytes()).map_err(|e| e.to_string())?;

    let mut infos: Vec<blown_ref::FrameInfo> = Vec::new();
    let mut last_progress = Instant::now();
    let mut write_err = None;
    let mut on = |ev: blown_ref::Event| match ev {
        blown_ref::Event::Frame { positions, info } => {
            let f = infos.len();
            let res = fs::File::create(dir.join("frames").join(format!("{f:05}.bin")))
                .map_err(|e| e.to_string())
                .and_then(|file| write_frame(&mut BufWriter::new(file), &positions).map_err(|e| e.to_string()));
            if let Err(e) = res {
                write_err = Some(e);
            }
            eprintln!(
                "  frame {f:3}  t {:.4} s  height {:6.1} mm  water {:6.3} L  pressure {:6.3} bar  peak plastic strain {:5.1} %",
                info.time,
                info.height_mm,
                info.volume_ml / 1000.0,
                info.pressure_bar.unwrap_or(0.0),
                info.max_stretch_pct
            );
            infos.push(info);
            let manifest = json!({ "name": name, "frames": infos.len(), "done": false, "info": infos });
            let _ = write_atomic(&dir.join("manifest.json"), manifest.to_string().as_bytes());
        }
        blown_ref::Event::Progress { fraction, seconds_left, .. } => {
            if last_progress.elapsed().as_secs() >= 60 {
                last_progress = Instant::now();
                eprintln!("  … {:.0} %, engine estimate {:.0} min to the end of pumping", 100.0 * fraction, seconds_left.unwrap_or(0.0) / 60.0);
            }
        }
    };
    let outcome = blown_ref::run(&job, &ctl, &mut on)?;
    if let Some(e) = write_err {
        return Err(e);
    }
    if let Some(last) = infos.last_mut() {
        last.status = "settled";
    }
    let manifest = json!({ "name": name, "frames": infos.len(), "done": true, "info": infos, "seconds": outcome.seconds });
    write_atomic(&dir.join("manifest.json"), manifest.to_string().as_bytes()).map_err(|e| e.to_string())?;
    eprintln!("[{name}] {} ({:.1} min) -> {}", outcome.message, outcome.seconds / 60.0, dir.display());
    Ok(())
}

/// Print the water pressure and volume through a reference run.
fn ref_water(args: &[String]) -> Result<(), String> {
    let dir = PathBuf::from(args.first().unwrap_or_else(|| usage()));
    let bytes = fs::read(dir.join("modelT01")).map_err(|e| e.to_string())?;
    let h = blown_core::reference::read_water_history(&bytes);
    let step = (h.len() / 20).max(1);
    for s in h.iter().step_by(step).chain(h.last()) {
        println!("t {:.4} s  water {:7.3} L  pressure {:6.3} bar", s.time, s.volume_mm3 / 1.0e6, s.pressure_mpa * 10.0);
    }
    println!("{} samples", h.len());
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("run") => run(&parse_run(&args[1..])),
        Some("suite") => {
            let out = args.iter().position(|a| a == "--out").and_then(|i| args.get(i + 1)).map(PathBuf::from);
            suite(&out.unwrap_or_else(|| PathBuf::from("runs")))
        }
        Some("ref-deck") => ref_deck(&args[1..]),
        Some("ref-water") => ref_water(&args[1..]),
        Some("ref-run") => ref_run(&args[1..]),
        _ => usage(),
    };
    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
