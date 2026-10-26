//! Built-in test outlines (mm, centred on the origin).

use std::f64::consts::PI;

use crate::outline::{Piece, P2};

fn ellipse_pts(rx: f64, ry: f64, n: usize) -> Vec<P2> {
    (0..n)
        .map(|i| {
            let a = 2.0 * PI * i as f64 / n as f64;
            [rx * a.cos(), ry * a.sin()]
        })
        .collect()
}

/// Circle of the given diameter.
pub fn circle(diameter: f64) -> Piece {
    Piece::new(ellipse_pts(diameter / 2.0, diameter / 2.0, 256))
}

pub fn ellipse(width: f64, height: f64) -> Piece {
    Piece::new(ellipse_pts(width / 2.0, height / 2.0, 256))
}

pub fn rect(width: f64, height: f64) -> Piece {
    let (w, h) = (width / 2.0, height / 2.0);
    Piece::new(vec![[-w, -h], [w, -h], [w, h], [-w, h]])
}

pub fn square(size: f64) -> Piece {
    rect(size, size)
}

/// Regular polygon with `sides` corners, given its circumscribed diameter.
pub fn polygon(sides: usize, diameter: f64) -> Piece {
    let n = sides.max(3);
    let r = diameter / 2.0;
    Piece::new(
        (0..n)
            .map(|i| {
                let a = PI / 2.0 + 2.0 * PI * i as f64 / n as f64;
                [r * a.cos(), r * a.sin()]
            })
            .collect(),
    )
}

/// L-shape fitting in a `size` square; each arm is half the size wide.
pub fn lshape(size: f64) -> Piece {
    let s = size / 2.0;
    Piece::new(vec![[-s, -s], [s, -s], [s, 0.0], [0.0, 0.0], [0.0, s], [-s, s]])
}

/// Surfboard outline: `length` long, about 0.28 × length wide, pointed-ish
/// nose, squarer tail.
pub fn surfboard(length: f64) -> Piece {
    let n = 96;
    let half_w = 0.14 * length;
    // u = 0 at the (squared) tail, 1 at the nose.
    let half = |u: f64| half_w * (PI * (0.08 + 0.92 * u)).sin().max(0.0).powf(0.6) * (1.0 - 0.15 * u);
    let x = |u: f64| (u - 0.5) * length;
    let mut pts: Vec<P2> = (0..=n).map(|i| i as f64 / n as f64).map(|u| [x(u), -half(u)]).collect();
    pts.extend((0..n).rev().map(|i| i as f64 / n as f64).map(|u| [x(u), half(u)]));
    Piece::new(dedupe(pts))
}

/// A square with a round welded cut-out (useful for testing holes).
pub fn ring(size: f64) -> Piece {
    let mut p = square(size);
    let mut hole = ellipse_pts(size * 0.18, size * 0.18, 96);
    hole.reverse();
    p.holes.push(hole);
    p
}

/// Hexagon split into six triangular cells by welds from the centre to each
/// corner (the "flower" wall panels).
pub fn hexstar(size: f64) -> Piece {
    let mut p = polygon(6, size);
    let corners = p.outer.clone();
    for c in corners {
        p.seams.push(vec![[0.0, 0.0], c]);
    }
    p
}

/// Square quilted into four cells by two crossing welds edge to edge.
pub fn quilt(size: f64) -> Piece {
    let mut p = square(size);
    let s = size / 2.0;
    p.seams.push(vec![[-s, 0.0], [s, 0.0]]);
    p.seams.push(vec![[0.0, -s], [0.0, s]]);
    p
}

fn dedupe(pts: Vec<P2>) -> Vec<P2> {
    let mut out: Vec<P2> = Vec::with_capacity(pts.len());
    for p in pts {
        if out.last().map_or(true, |q| (q[0] - p[0]).abs() + (q[1] - p[1]).abs() > 1e-9) {
            out.push(p);
        }
    }
    out
}

/// Look up a test shape by name (used by the command-line tool).
pub fn by_name(name: &str, size: f64) -> Option<Piece> {
    Some(match name {
        "circle" => circle(size),
        "square" => square(size),
        "lshape" | "l" => lshape(size),
        "surfboard" => surfboard(size),
        "ring" => ring(size),
        "hexagon" => polygon(6, size),
        "hexstar" => hexstar(size),
        "quilt" => quilt(size),
        "triangle" => polygon(3, size),
        "ellipse" => ellipse(size, size * 0.6),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outline::self_intersects;

    #[test]
    fn shapes_are_simple() {
        for name in ["circle", "square", "lshape", "surfboard", "ring", "hexagon", "hexstar", "quilt"] {
            let p = by_name(name, 300.0).unwrap();
            assert!(!self_intersects(&p.outer, true), "{name} self-intersects");
            assert!(p.area() > 0.0, "{name} has no area");
        }
    }
}
