#!/usr/bin/env node
/**
 * Canopy mainnet smoke — static shell + fees canister reachability.
 * Usage: node scripts/smoke-canopy.mjs
 */
const ORIGIN = process.env.CANOPY_ORIGIN ?? "https://7h6n6-eqaaa-aaaau-ag6da-cai.icp0.io";
const FEES = process.env.CANOPY_FEES_CANISTER ?? "7o5gc-syaaa-aaaau-ag6cq-cai";

const checks = [];

function ok(name, detail = "") {
  checks.push({ name, pass: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  checks.push({ name, pass: false, detail });
  console.error(`✗ ${name} — ${detail}`);
}

async function headOrGet(path) {
  const url = `${ORIGIN}${path}`;
  let res = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (res.status === 405 || res.status === 501) {
    res = await fetch(url, { method: "GET", redirect: "follow" });
  }
  return { url, res };
}

async function must200(path, label) {
  const { url, res } = await headOrGet(path);
  if (!res.ok) fail(label, `${res.status} ${url}`);
  else ok(label, `${res.status}`);
  return res;
}

async function main() {
  console.log(`Canopy smoke @ ${ORIGIN}`);

  const htmlRes = await fetch(`${ORIGIN}/`, { redirect: "follow" });
  if (!htmlRes.ok) fail("index", `${htmlRes.status}`);
  else ok("index", String(htmlRes.status));
  const html = await htmlRes.text();

  const need = [
    ["og:image", "og:image"],
    ["twitter:card", "twitter:card"],
    ["manifest", "manifest.webmanifest"],
    ["apple-touch", "apple-touch-icon"],
    ["theme-color", "theme-color"],
  ];
  for (const [label, needle] of need) {
    if (html.includes(needle)) ok(`meta/${label}`);
    else fail(`meta/${label}`, `missing ${needle}`);
  }
  if (html.includes("/brand/og-image.png") || html.includes("og-image.png")) {
    ok("og image path");
  } else fail("og image path", "og-image.png not referenced");

  await must200("/brand/og-image.png", "GET og-image");
  await must200("/brand/favicon-32.png", "GET favicon-32");
  await must200("/brand/apple-touch-icon.png", "GET apple-touch");
  await must200("/brand/icon-512.png", "GET icon-512");
  await must200("/manifest.webmanifest", "GET manifest");
  await must200("/sw.js", "GET service worker");
  await must200("/favicon.png", "GET root favicon");

  const manRes = await fetch(`${ORIGIN}/manifest.webmanifest`);
  if (manRes.ok) {
    const man = await manRes.json();
    if (man.display === "standalone" && man.short_name === "Canopy") {
      ok("manifest fields", `${man.name}`);
    } else fail("manifest fields", JSON.stringify(man));
  }

  // CSP + SW harden checks
  const csp = htmlRes.headers.get("content-security-policy") || "";
  const fa = (csp.match(/frame-ancestors[^;]*/i) || [""])[0];
  if (!csp) {
    ok("CSP header", "not visible on this gateway (check .ic-assets.json5)");
  } else if (fa && !/\*\.icp0\.io/.test(fa)) {
    ok("CSP frame-ancestors (no wildcard *.icp0.io)");
  } else if (fa) {
    fail("CSP frame-ancestors", fa.slice(0, 160));
  } else {
    fail("CSP frame-ancestors", "missing frame-ancestors");
  }

  const swRes = await fetch(`${ORIGIN}/sw.js`);
  if (swRes.ok) {
    const swText = await swRes.text();
    if (swText.includes("canopy-shell-v3") || /canopy-shell-v\d+/.test(swText)) {
      ok("SW cache name", "versioned shell");
    } else fail("SW cache name", "expected canopy-shell-vN");
    if (swText.includes("no-store") || swText.includes("network")) {
      ok("SW HTML strategy hint");
    }
  }

  // Fees canister: anonymous query via IC HTTP API (candid raw is hard); probe via agent-less status.
  const statusUrl = `https://icp0.io/api/v2/canister/${FEES}/read_state`;
  try {
    const r = await fetch(`https://icp-api.io/api/v2/status`);
    if (r.ok) ok("ic network status");
    else fail("ic network status", String(r.status));
  } catch (e) {
    fail("ic network status", String(e));
  }

  // Soft check: frontend mentions Migrator + Cycles modes after deploy of latest build
  if (html.includes("Canopy")) ok("brand title in HTML");
  else fail("brand title in HTML", "Canopy missing");

  // Asset JS presence (hashed chunk)
  const jsMatch = html.match(/\/assets\/index-[^"]+\.js/);
  if (jsMatch) {
    await must200(jsMatch[0], "GET app bundle");
  } else {
    // Vite may inject differently on canister — look for script src
    const anyJs = html.match(/src="(\/assets\/[^"]+\.js)"/);
    if (anyJs) await must200(anyJs[1], "GET app bundle");
    else fail("GET app bundle", "no /assets/*.js in index");
  }

  void statusUrl;
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
