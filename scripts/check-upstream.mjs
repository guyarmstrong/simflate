// Runs before every installer build (tauri beforeBuildCommand). Stops the
// build when OpenCourant has moved on since the copy we ship, so the release
// gets looked at first: issue #67 (the starter's 20,000 failed opens of
// model_NNNN.rad, 30–70 s on antivirus laptops) closed, or a newer release.
//   Look, then build anyway:  SIMFLATE_UPSTREAM_CHECKED=1 npx tauri build ...
// On GitHub Actions, or with no network, it only warns.
const REPO = 'OpenCourant/OpenCourant';
const ISSUE = 67;
const SHIPPED = 'latest-20261011'; // vendor/opencourant/manifest.json "release"

const ci = !!process.env.CI;
const ack = process.env.SIMFLATE_UPSTREAM_CHECKED === '1';

async function get(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'simflate-build' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return r.json();
}

try {
  const [issue, release] = await Promise.all([get(`issues/${ISSUE}`), get('releases/latest')]);
  const news = [];
  if (issue.state === 'closed') news.push(`issue #${ISSUE} (slow starter) is CLOSED`);
  if (release.tag_name !== SHIPPED) news.push(`newer release ${release.tag_name} (we ship ${SHIPPED})`);
  if (!news.length) {
    console.log(`OpenCourant: no change since ${SHIPPED}; issue #${ISSUE} still open.`);
  } else {
    const msg = `OpenCourant has moved on: ${news.join('; ')}.\n` +
      `  Check whether it fixes fill_igr.F (https://github.com/${REPO}/issues/${ISSUE}); if so, repack it\n` +
      `  (node scripts/opencourant.mjs pack <folder>) and re-test Reference before building.\n` +
      `  To build anyway after looking: SIMFLATE_UPSTREAM_CHECKED=1`;
    if (ci || ack) console.warn(`Warning: ${msg}`);
    else {
      console.error(`STOP: ${msg}`);
      process.exit(1);
    }
  }
} catch (e) {
  console.warn(`OpenCourant check skipped (${e.message}); look at https://github.com/${REPO}/issues/${ISSUE} by hand.`);
}
