//! Colour batches: constraints grouped so no two in a batch share a point.
//! A batch can then be projected by several cores at once with exactly the
//! same arithmetic as one core going through it in order, so a run gives the
//! same result on any number of cores (and in the browser, which uses one).
//! The `parallel` feature (desktop app, CLI) spreads each batch over threads.

use std::ops::Range;

/// One batch: a run of constraint indices, and whether its members are
/// independent (the last batch holds any that didn't fit in 64 colours and is
/// done in order).
#[derive(Clone, Debug)]
pub struct Batch {
    pub range: Range<usize>,
    pub independent: bool,
}

/// Greedily colour `items` by the points they touch, reorder them by colour
/// (stable, so each batch keeps the mesh's order) and return the batches.
pub fn colour<T>(items: &mut Vec<T>, num_points: usize, points: impl Fn(&T) -> [u32; 4]) -> Vec<Batch> {
    const SPILL: usize = 64;
    // Colours this small aren't worth a hand-off between cores: they join
    // the in-order spill batch at the end.
    const SMALL: usize = 512;
    let mut used = vec![0u64; num_points];
    let mut colour_of = Vec::with_capacity(items.len());
    for it in items.iter() {
        let pts = points(it);
        let busy = pts.iter().fold(0u64, |m, &p| m | used[p as usize]);
        let c = (!busy).trailing_zeros() as usize;
        if c < SPILL {
            for &p in &pts {
                used[p as usize] |= 1 << c;
            }
        }
        colour_of.push(c.min(SPILL));
    }
    let mut size = [0usize; SPILL + 1];
    for &c in &colour_of {
        size[c] += 1;
    }
    for c in colour_of.iter_mut() {
        if size[*c] < SMALL {
            *c = SPILL;
        }
    }
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by_key(|&i| colour_of[i]);
    let mut slots: Vec<Option<T>> = items.drain(..).map(Some).collect();
    items.extend(order.iter().map(|&i| slots[i].take().expect("each item once")));

    let mut batches: Vec<Batch> = Vec::new();
    let mut start = 0;
    for k in 1..=order.len() {
        if k == order.len() || colour_of[order[k]] != colour_of[order[start]] {
            batches.push(Batch { range: start..k, independent: colour_of[order[start]] < SPILL });
            start = k;
        }
    }
    batches
}

/// A pointer shared across threads that write to disjoint elements.
#[derive(Clone, Copy)]
pub struct Shared<T>(pub *mut T);
unsafe impl<T> Send for Shared<T> {}
unsafe impl<T> Sync for Shared<T> {}

impl<T> Shared<T> {
    /// # Safety
    /// No other thread may touch element `i` at the same time.
    #[allow(clippy::mut_from_ref)]
    #[inline]
    pub unsafe fn at(&self, i: usize) -> &mut T {
        &mut *self.0.add(i)
    }
}

/// Run `f` for every index of every batch, batch after batch.
pub fn for_batches(batches: &[Batch], f: impl Fn(usize) + Sync + Send) {
    #[cfg(feature = "parallel")]
    if let Some(team) = team::get() {
        if batches.iter().map(|b| b.range.len()).sum::<usize>() >= 4096 {
            return team.run(batches, &f);
        }
    }
    for b in batches {
        b.range.clone().for_each(&f);
    }
}

/// A fixed team of threads that goes through all the batches of one pass
/// together: woken once per pass, a quick spin hand-off between batches
/// (waking threads per batch cost as much as the work), and points handed
/// out in small chunks so faster and slower cores share the load.
#[cfg(feature = "parallel")]
mod team {
    use super::Batch;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::OnceLock;

    pub struct Team {
        pool: rayon::ThreadPool,
        size: usize,
    }

    static TEAM: OnceLock<Option<Team>> = OnceLock::new();

    /// Threads: BLOWN_THREADS if set, else the CPU's threads up to 6. On
    /// Guy's 14-core i7-12700H (Medium leaf): 1 → 100 ms/frame, 4–6 → 55,
    /// 8 → 62 (the hand-offs between batches start to cost more than they save).
    pub fn get() -> Option<&'static Team> {
        TEAM.get_or_init(|| {
            let avail = std::thread::available_parallelism().map_or(1, |n| n.get());
            let size = std::env::var("BLOWN_THREADS").ok().and_then(|v| v.parse().ok()).unwrap_or(avail.min(6)).max(1);
            if size < 2 {
                return None;
            }
            let pool = rayon::ThreadPoolBuilder::new().num_threads(size).thread_name(|i| format!("blown-solver-{i}")).build().ok()?;
            Some(Team { pool, size })
        })
        .as_ref()
    }

    impl Team {
        pub fn run(&self, batches: &[Batch], f: &(impl Fn(usize) + Sync)) {
            const CHUNK: usize = 64;
            let next: Vec<AtomicUsize> = batches.iter().map(|b| AtomicUsize::new(b.range.start)).collect();
            let arrived = AtomicUsize::new(0);
            let n = self.size;
            // broadcast runs the closure on every pool thread at once, so the
            // barrier below can't wait on a thread that never started.
            self.pool.broadcast(|ctx| {
                for (i, b) in batches.iter().enumerate() {
                    if b.independent {
                        loop {
                            let s = next[i].fetch_add(CHUNK, Ordering::Relaxed);
                            if s >= b.range.end {
                                break;
                            }
                            for k in s..(s + CHUNK).min(b.range.end) {
                                f(k);
                            }
                        }
                    } else if ctx.index() == 0 {
                        b.range.clone().for_each(f);
                    }
                    // Barrier: everyone finishes batch i before batch i + 1.
                    let target = (i + 1) * n;
                    arrived.fetch_add(1, Ordering::AcqRel);
                    let mut spins = 0u32;
                    while arrived.load(Ordering::Acquire) < target {
                        spins += 1;
                        if spins < 200_000 {
                            std::hint::spin_loop();
                        } else {
                            std::thread::yield_now();
                        }
                    }
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batches_never_share_a_point() {
        // A strip of quads: each link touches two points.
        let mut links: Vec<[u32; 2]> = (0..200u32).flat_map(|i| [[i, i + 1], [i, i + 201], [i + 201, i + 202]]).collect();
        let n = links.len();
        let batches = colour(&mut links, 402, |l| [l[0], l[1], l[0], l[1]]);
        assert_eq!(batches.iter().map(|b| b.range.len()).sum::<usize>(), n);
        for b in batches.iter().filter(|b| b.independent) {
            let mut seen = std::collections::BTreeSet::new();
            for l in &links[b.range.clone()] {
                assert!(seen.insert(l[0]) && seen.insert(l[1]), "batch shares a point");
            }
        }
    }
}
