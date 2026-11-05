#!/usr/bin/env node
/**
 * Pull icrc1:logo (+ SNS root logos) for ICPSwap TokenList ledgers and
 * materialize them under public/brand/token-logos/ for Canopy.
 *
 * Usage: node scripts/fetch-token-logos.mjs
 */
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "frontend/public/brand/token-logos");
const GEN_TS = join(ROOT, "frontend/src/lib/tokens/logoCatalog.generated.ts");
const IC_HOST = "https://icp0.io";
const TOKEN_LIST = "k37c6-riaaa-aaaag-qcyza-cai";
const ICP = "ryjl3-tyaaa-aaaaa-aaaba-cai";

const tokenListIdl = ({ IDL: I }) => {
  const Media = I.Record({ mediaType: I.Text, link: I.Text });
  const Config = I.Record({ name: I.Text, value: I.Text });
  const TokenMetadata = I.Record({
    canisterId: I.Text,
    configs: I.Vec(Config),
    decimals: I.Nat,
    fee: I.Nat,
    introduction: I.Text,
    mediaLinks: I.Vec(Media),
    name: I.Text,
    rank: I.Nat32,
    standard: I.Text,
    symbol: I.Text,
    totalSupply: I.Nat,
  });
  return I.Service({
    getList: I.Func(
      [],
      [I.Variant({ ok: I.Vec(TokenMetadata), err: I.Text })],
      ["query"],
    ),
  });
};

const metaIdl = ({ IDL: I }) => {
  const Value = I.Variant({
    Text: I.Text,
    Nat: I.Nat,
    Int: I.Int,
    Blob: I.Vec(I.Nat8),
  });
  return I.Service({
    icrc1_metadata: I.Func([], [I.Vec(I.Tuple(I.Text, Value))], ["query"]),
  });
};

function extFromMime(mime) {
  if (mime.includes("svg")) return "svg";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || "image/png";
  const isB64 = Boolean(m[2]);
  const payload = m[3] || "";
  const buf = isB64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { mime, buf, ext: extFromMime(mime) };
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) throw new Error("HTML not image");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function fetchSnsMap(agent) {
  const map = {};
  await Promise.all(
    Array.from({ length: 8 }, async (_, page) => {
      const url = `https://3r4gx-wqaaa-aaaaq-aaaia-cai.raw.icp0.io/v1/sns/list/page/${page}/slow.json`;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        for (const s of await res.json()) {
          const ledger = s.canister_ids?.ledger_canister_id?.toLowerCase();
          const root = s.canister_ids?.root_canister_id;
          if (!ledger) continue;
          const meta = (s.icrc1_metadata || []).find((m) => m[0] === "icrc1:logo");
          const text = meta?.[1]?.Text || meta?.[1]?.text;
          if (text?.startsWith("data:") || text?.startsWith("http")) {
            map[ledger] = text;
          } else if (root) {
            map[ledger] =
              `https://3r4gx-wqaaa-aaaaq-aaaia-cai.raw.icp0.io/v1/sns/root/${root}/logo.png`;
          }
        }
      } catch {
        /* skip page */
      }
    }),
  );
  void agent;
  return map;
}

mkdirSync(OUT_DIR, { recursive: true });

const agent = await HttpAgent.create({ host: IC_HOST });
const listActor = Actor.createActor(tokenListIdl, {
  agent,
  canisterId: TOKEN_LIST,
});
const listed = await listActor.getList();
if (listed.err) throw new Error(listed.err);
const rows = listed.ok;
const sns = await fetchSnsMap(agent);

const ids = new Set(rows.map((r) => r.canisterId.toLowerCase()));
ids.add(ICP);
// seed extras
for (const id of [
  "um5iw-rqaaa-aaaaq-qaaba-cai",
  "zfcdd-tqaaa-aaaaq-aaaga-cai",
  "2ouva-viaaa-aaaaq-aaamq-cai",
]) {
  ids.add(id);
}

const catalog = {
  [ICP]: "/brand/tokens/icp-official.png",
};
let ok = 0;
let fail = 0;

const queue = [...ids];
const concurrency = 12;
let i = 0;

async function worker() {
  while (i < queue.length) {
    const idx = i++;
    const id = queue[idx];
    if (id === ICP) {
      ok++;
      continue;
    }
    try {
      let logo = null;
      try {
        const actor = Actor.createActor(metaIdl, { agent, canisterId: id });
        const meta = await actor.icrc1_metadata();
        const row = meta.find((m) => m[0] === "icrc1:logo");
        logo = row?.[1]?.Text || null;
      } catch {
        logo = null;
      }
      if (!logo) logo = sns[id] || null;
      if (!logo) {
        fail++;
        console.log("MISS", id);
        continue;
      }

      if (logo.startsWith("data:")) {
        const parsed = parseDataUrl(logo);
        if (!parsed || parsed.buf.length < 32) {
          fail++;
          continue;
        }
        // Cap giant logos (~250KB) — still usable as icons
        if (parsed.buf.length > 900_000) {
          console.log("SKIP huge", id, parsed.buf.length);
          // Prefer SNS http fallback if any
          if (sns[id]?.startsWith("http")) {
            logo = sns[id];
          } else {
            fail++;
            continue;
          }
        } else {
          const file = `${id}.${parsed.ext}`;
          const dest = join(OUT_DIR, file);
          writeFileSync(dest, parsed.buf);
          catalog[id] = `/brand/token-logos/${file}`;
          ok++;
          console.log("FILE", id, parsed.ext, parsed.buf.length);
          continue;
        }
      }

      if (logo.startsWith("http")) {
        // Prefer IC-hosted; skip ordinals / random web for CSP
        const hostOk =
          /\.icp0\.io|\.ic0\.app|internetcomputer\.org/i.test(logo) ||
          logo.includes("3r4gx-wqaaa");
        if (!hostOk) {
          // still try to mirror into our assets when possible
          try {
            const ext = logo.includes(".svg")
              ? "svg"
              : logo.includes(".jpg") || logo.includes(".jpeg")
                ? "jpg"
                : "png";
            const file = `${id}.${ext}`;
            const dest = join(OUT_DIR, file);
            await download(logo, dest);
            catalog[id] = `/brand/token-logos/${file}`;
            ok++;
            console.log("DL", id, logo.slice(0, 60));
            continue;
          } catch {
            fail++;
            console.log("BAD_URL", id, logo.slice(0, 80));
            continue;
          }
        }
        try {
          const ext = logo.includes(".svg") ? "svg" : "png";
          const file = `${id}.${ext}`;
          const dest = join(OUT_DIR, file);
          if (!existsSync(dest)) await download(logo, dest);
          catalog[id] = `/brand/token-logos/${file}`;
          ok++;
          console.log("IC", id);
        } catch (e) {
          // keep remote URL if on IC (CSP allows *.icp0.io)
          catalog[id] = logo;
          ok++;
          console.log("REMOTE", id, e.message);
        }
        continue;
      }
      fail++;
    } catch (e) {
      fail++;
      console.log("ERR", id, e.message);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const ts = `/* AUTO-GENERATED by scripts/fetch-token-logos.mjs — do not edit */
export const LOGO_CATALOG: Record<string, string> = ${JSON.stringify(catalog, null, 2)};
`;
writeFileSync(GEN_TS, ts);
console.log(`\nDone ok=${ok} fail=${fail} catalog=${Object.keys(catalog).length}`);
console.log("wrote", GEN_TS);
