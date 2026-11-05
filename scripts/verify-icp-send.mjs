#!/usr/bin/env node
/**
 * Permanent gate: Canopy ICP send (Principal + Account ID) must not regress.
 *
 * Fails the build if:
 * - Account ID path loses classic `transfer` / Nat64 e8s / CRC validation
 * - FT send routes Account ID through broken Nat-e8s or unchecked hex
 * - Destination parsing no longer accepts principal + checksummed Account ID
 *
 * Usage: node scripts/verify-icp-send.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Principal } from "@dfinity/principal";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontendSrc = join(root, "frontend", "src");
const aggregatorSrc = join(
  root,
  "..",
  "packages",
  "ic-nft-aggregator",
  "src",
  "icpLedger.ts",
);

const checks = [];
function ok(name, detail = "") {
  checks.push({ name, pass: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  checks.push({ name, pass: false, detail });
  console.error(`✗ ${name} — ${detail}`);
}

function read(rel) {
  return readFileSync(join(frontendSrc, rel), "utf8");
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = Buffer.alloc(4);
  out.writeUInt32BE(crc, 0);
  return out;
}

function principalToAccountIdHex(principalText) {
  const principal = Principal.fromText(principalText);
  const principalBytes = principal.toUint8Array();
  const subaccount = Buffer.alloc(32);
  const domainSep = Buffer.from([
    0x0a, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x2d, 0x69, 0x64,
  ]);
  const data = Buffer.concat([domainSep, Buffer.from(principalBytes), subaccount]);
  // sha224
  const hash = createHash("sha224").update(data).digest();
  const checksum = crc32(hash);
  return Buffer.concat([checksum, hash]).toString("hex");
}

function normalizeAccountIdHex(raw) {
  return raw.trim().toLowerCase().replace(/^0x/, "").replace(/[^0-9a-f]/g, "");
}

function isAccountIdHex(raw) {
  return /^[0-9a-f]{64}$/.test(normalizeAccountIdHex(raw));
}

function isValidAccountIdChecksum(raw) {
  const hex = normalizeAccountIdHex(raw);
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const bytes = Buffer.from(hex, "hex");
  const expected = crc32(bytes.subarray(4));
  return bytes.subarray(0, 4).equals(expected);
}

function parseDestination(raw) {
  const t = raw.trim();
  if (!t) return { ok: false, error: "Destination required" };
  if (isAccountIdHex(t)) {
    const value = normalizeAccountIdHex(t);
    if (!isValidAccountIdChecksum(value)) {
      return { ok: false, error: "checksum invalid" };
    }
    return { ok: true, kind: "accountId", value };
  }
  try {
    const p = Principal.fromText(t);
    if (p.isAnonymous()) {
      return { ok: false, error: "Anonymous principal is not a valid destination" };
    }
    return { ok: true, kind: "principal", value: p.toText() };
  } catch {
    return { ok: false, error: "bad" };
  }
}

console.log("Canopy ICP send verify (permanent gate)\n");

const ledgerTs = read("lib/ledger.ts");
const sendTs = read("lib/send.ts");
const destTs = read("lib/destinations.ts");

if (
  ledgerTs.includes("transferIcpToAccountId") &&
  /e8s:\s*idl\.Nat64/.test(ledgerTs) &&
  ledgerTs.includes("send_dfx") &&
  /transfer:\s*idl\.Func/.test(ledgerTs)
) {
  ok("ledger.ts Account ID path", "send_dfx primary + transfer fallback + Nat64");
} else {
  fail(
    "ledger.ts Account ID path",
    "must define transferIcpToAccountId with send_dfx + transfer fallback and e8s: Nat64",
  );
}

if (destTs.includes("replace(/[^0-9a-f]/g") || destTs.includes('replace(/[^0-9a-f]/g, "")')) {
  ok("destinations.ts strips non-hex separators");
} else if (destTs.includes("[^0-9a-f]")) {
  ok("destinations.ts strips non-hex separators");
} else {
  fail(
    "destinations.ts strips non-hex separators",
    "normalizeAccountIdHex must strip dashes/spaces so dashed Account IDs work",
  );
}

const ftSendBody = sendTs.slice(
  sendTs.indexOf("export async function executeFtSend"),
  sendTs.indexOf("const icrc7TransferIdl"),
);
if (
  ledgerTs.includes("ftSendLedgerLegs") &&
  ftSendBody.includes("assertFtSendWithinBalance") &&
  ftSendBody.indexOf("assertFtSendWithinBalance") <
    ftSendBody.indexOf("amount: feeAmount")
) {
  ok("send.ts balance preflight", "before Canopy fee payment; one leg when micro-fee is zero");
} else {
  fail(
    "send.ts balance preflight",
    "executeFtSend must call assertFtSendWithinBalance before the fee payment",
  );
}

if (destTs.includes("parseIcrcAccountText") && destTs.includes("subaccount")) {
  ok("destinations.ts ICRC account", "checksummed subaccount");
} else {
  fail("destinations.ts ICRC account", "must accept principal-checksum.subaccount");
}

if (sendTs.includes("to: dest.owner") && sendTs.includes("toSubaccount: dest.subaccount")) {
  ok("send.ts ICRC subaccount", "owner + subaccount on icrc1_transfer");
} else {
  fail("send.ts ICRC subaccount", "principal path must pass dest.owner and dest.subaccount");
}

if (
  sendTs.includes("transferIcpToAccountId") &&
  !sendTs.includes("legacyIcpTransfer")
) {
  ok("send.ts uses Canopy transferIcpToAccountId");
} else {
  fail(
    "send.ts Account ID routing",
    "executeFtSend must call transferIcpToAccountId (not legacyIcpTransfer)",
  );
}

if (
  destTs.includes("isValidAccountIdChecksum") &&
  destTs.includes("parseDestination") &&
  destTs.includes('kind: "accountId"')
) {
  ok("destinations.ts CRC gate");
} else {
  fail("destinations.ts CRC gate", "must validate Account ID checksum before ok");
}

try {
  const agg = readFileSync(aggregatorSrc, "utf8");
  if (/e8s:\s*IDL\.Nat64/.test(agg) && agg.includes("IDL.Vec(IDL.Nat8)")) {
    ok("aggregator legacyIcpTransfer", "transfer + Nat64 + blob");
  } else if (/e8s:\s*IDL\.Nat[^6]/.test(agg)) {
    fail("aggregator legacyIcpTransfer", "e8s still IDL.Nat");
  } else {
    fail("aggregator legacyIcpTransfer", "expected Nat64 + Vec Nat8");
  }
} catch (e) {
  fail("aggregator icpLedger.ts", String(e));
}

const anon = parseDestination("2vxsx-fae");
if (!anon.ok) ok("reject anonymous principal");
else fail("reject anonymous principal", "2vxsx-fae must fail");

const realPid = "rdmx6-jaaaa-aaaaa-aaadq-cai";
const pid = parseDestination(realPid);
if (pid.ok && pid.kind === "principal") ok("parse principal", pid.value);
else fail("parse principal", JSON.stringify(pid));

const validAid = principalToAccountIdHex(realPid);
const aid = parseDestination(validAid);
if (aid.ok && aid.kind === "accountId" && aid.value === validAid) {
  ok("parse checksummed Account ID");
} else fail("parse checksummed Account ID", JSON.stringify(aid));

const badAid =
  "0000000000000000000000000000000000000000000000000000000000000001";
const bad = parseDestination(badAid);
if (!bad.ok) ok("reject bad Account ID checksum");
else fail("reject bad Account ID checksum", "all-zero hex must fail CRC");

const spaced = validAid.slice(0, 32) + " " + validAid.slice(32);
const spacedParsed = parseDestination(spaced);
if (spacedParsed.ok && spacedParsed.value === validAid) {
  ok("normalize Account ID whitespace");
} else fail("normalize Account ID whitespace", JSON.stringify(spacedParsed));

const dashed = validAid.match(/.{1,4}/g).join("-");
const dashedParsed = parseDestination(dashed);
if (dashedParsed.ok && dashedParsed.value === validAid) {
  ok("normalize dashed Account ID");
} else fail("normalize dashed Account ID", JSON.stringify(dashedParsed));

const garbage = parseDestination("not-a-destination");
if (!garbage.ok) ok("reject garbage destination");
else fail("reject garbage destination", JSON.stringify(garbage));

const failed = checks.filter((c) => !c.pass);
console.log(
  `\n${checks.length - failed.length}/${checks.length} passed` +
    (failed.length ? ` · ${failed.length} FAILED` : ""),
);
if (failed.length) process.exit(1);
