/**
 * Destination parsing + recent recipients (display / UX only).
 * Account ID sends are ICP-ledger legacy transfers; other ledgers need a principal.
 *
 * Account Identifier = 32 bytes: CRC32(last 28) ‖ last 28. Hex-only shape is not enough —
 * the ledger traps on bad checksums, so we validate CRC before SpendReview / fee payment.
 */
import { Principal } from "@dfinity/principal";

const RECENT_KEY = "canopy.recent.recipients.v1";
const MAX_RECENT = 8;

export type DestKind = "principal" | "accountId";

export type ParsedDestination =
  | { ok: true; kind: DestKind; value: string; label: string }
  | { ok: false; error: string };

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

function crc32Bytes(data: Uint8Array): Uint8Array {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, crc, false);
  return out;
}

/** Strip 0x / spaces / dashes / other separators; lowercase hex only. */
export function normalizeAccountIdHex(raw: string): string {
  return raw.trim().toLowerCase().replace(/^0x/, "").replace(/[^0-9a-f]/g, "");
}

export function isAccountIdHex(raw: string): boolean {
  return /^[0-9a-f]{64}$/.test(normalizeAccountIdHex(raw));
}

/** 32-byte Account Identifier for classic ledger `transfer`. */
export function accountIdHexToBytes(raw: string): Uint8Array {
  const hex = normalizeAccountIdHex(raw);
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("Invalid ICP Account ID (expected 64 hex characters)");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** True when first 4 bytes are CRC32 of the remaining 28 (NNS / ledger rule). */
export function isValidAccountIdChecksum(raw: string): boolean {
  try {
    const bytes = accountIdHexToBytes(raw);
    const expected = crc32Bytes(bytes.subarray(4));
    return (
      bytes[0] === expected[0] &&
      bytes[1] === expected[1] &&
      bytes[2] === expected[2] &&
      bytes[3] === expected[3]
    );
  } catch {
    return false;
  }
}

/** Parse principal or 64-char ICP Account Identifier (checksum required). */
export function parseDestination(raw: string): ParsedDestination {
  const t = raw.trim();
  if (!t) return { ok: false, error: "Destination required" };

  if (isAccountIdHex(t)) {
    const value = normalizeAccountIdHex(t);
    if (!isValidAccountIdChecksum(value)) {
      return {
        ok: false,
        error:
          "Account ID checksum is invalid — paste the full 64-character deposit address (not a truncated or mistyped hex)",
      };
    }
    return {
      ok: true,
      kind: "accountId",
      value,
      label: "Account ID",
    };
  }

  try {
    const p = Principal.fromText(t);
    if (p.isAnonymous()) {
      return { ok: false, error: "Anonymous principal is not a valid destination" };
    }
    return {
      ok: true,
      kind: "principal",
      value: p.toText(),
      label: "Principal",
    };
  } catch {
    return {
      ok: false,
      error:
        "Enter an Internet Identity principal or a 64-character ICP Account ID",
    };
  }
}

export type RecentRecipient = {
  value: string;
  kind: DestKind;
  label?: string;
  at: number;
};

export function loadRecentRecipients(): RecentRecipient[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RecentRecipient =>
          !!r &&
          typeof r === "object" &&
          typeof (r as RecentRecipient).value === "string" &&
          ((r as RecentRecipient).kind === "principal" ||
            (r as RecentRecipient).kind === "accountId"),
      )
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberRecipient(dest: {
  value: string;
  kind: DestKind;
  label?: string;
}): void {
  try {
    const prev = loadRecentRecipients().filter(
      (r) => r.value.toLowerCase() !== dest.value.toLowerCase(),
    );
    const next: RecentRecipient[] = [
      { value: dest.value, kind: dest.kind, label: dest.label, at: Date.now() },
      ...prev,
    ].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

export function shortenDest(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
