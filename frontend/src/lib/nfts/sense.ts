/**
 * Auto-sense NFT collection standard (ICRC-7 / EXT / DIP721) + thumbnail.
 */
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { IC_HOST, allowLedgerSpend } from "../constants";

export type NftStandard = "icrc7" | "ext" | "dip721" | "unknown";

export type SensedNftCollection = {
  id: string;
  name: string;
  standard: NftStandard;
  thumbnailUrl: string | null;
  source: "manual" | "discovered";
};

function isPrincipal(id: string): boolean {
  try {
    Principal.fromText(id.trim());
    return true;
  } catch {
    return false;
  }
}

const probeIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Value = I.Variant({
    Text: I.Text,
    Nat: I.Nat,
    Int: I.Int,
    Blob: I.Vec(I.Nat8),
    Bool: I.Bool,
  });
  return I.Service({
    icrc7_name: I.Func([], [I.Text], ["query"]),
    icrc7_symbol: I.Func([], [I.Opt(I.Text)], ["query"]),
    icrc7_collection_metadata: I.Func(
      [],
      [I.Vec(I.Tuple(I.Text, Value))],
      ["query"],
    ),
    icrc7_total_supply: I.Func([], [I.Nat], ["query"]),
    getName: I.Func([], [I.Text], ["query"]),
    name: I.Func([], [I.Text], ["query"]),
    dip721_name: I.Func([], [I.Text], ["query"]),
    dip721_metadata: I.Func([], [I.Vec(I.Tuple(I.Text, Value))], ["query"]),
    tokens: I.Func([], [I.Vec(I.Nat32)], ["query"]),
    getTokens: I.Func([], [I.Vec(I.Nat32)], ["query"]),
  });
};

type Probe = {
  icrc7_name?: () => Promise<string>;
  icrc7_collection_metadata?: () => Promise<
    Array<[string, { Text?: string }]>
  >;
  icrc7_total_supply?: () => Promise<bigint>;
  getName?: () => Promise<string>;
  name?: () => Promise<string>;
  dip721_name?: () => Promise<string>;
  tokens?: () => Promise<number[]>;
  getTokens?: () => Promise<number[]>;
};

function metaLogo(
  rows: Array<[string, { Text?: string }]> | undefined,
): string | null {
  if (!rows) return null;
  for (const [k, v] of rows) {
    if (/logo|image|thumbnail|icon/i.test(k) && v.Text) {
      const t = v.Text;
      if (t.startsWith("data:") || t.startsWith("http")) return t;
    }
  }
  return null;
}

function thumbCandidates(id: string): string[] {
  return [
    `https://${id}.raw.icp0.io/?index=0&type=thumbnail`,
    `https://${id}.raw.icp0.io/collection/logo.png`,
    `https://${id}.raw.icp0.io/logo.png`,
    `https://${id}.raw.icp0.io/thumbnails/0.png`,
  ];
}

export async function senseNftCollection(
  canisterId: string,
): Promise<SensedNftCollection> {
  const id = canisterId.trim().toLowerCase();
  if (!isPrincipal(id)) {
    throw new Error("Enter a valid canister principal");
  }

  const agent = await HttpAgent.create({ host: IC_HOST });
  const actor = Actor.createActor(probeIdl, {
    agent,
    canisterId: id,
  }) as Probe;

  let standard: NftStandard = "unknown";
  let name = id.slice(0, 12);
  let thumbnailUrl: string | null = null;

  // ICRC-7
  try {
    const n = await actor.icrc7_name?.();
    if (typeof n === "string" && n.length) {
      standard = "icrc7";
      name = n;
      try {
        const meta = await actor.icrc7_collection_metadata?.();
        thumbnailUrl = metaLogo(meta);
      } catch {
        /* optional */
      }
    }
  } catch {
    /* not icrc7 */
  }

  if (standard === "unknown") {
    try {
      await actor.icrc7_total_supply?.();
      standard = "icrc7";
    } catch {
      /* */
    }
  }

  // EXT
  if (standard === "unknown") {
    try {
      const n =
        (await actor.getName?.().catch(() => null)) ||
        (await actor.name?.().catch(() => null));
      if (typeof n === "string" && n.length) {
        standard = "ext";
        name = n;
      }
    } catch {
      /* */
    }
  }
  if (standard === "unknown") {
    try {
      const toks =
        (await actor.getTokens?.().catch(() => null)) ||
        (await actor.tokens?.().catch(() => null));
      if (Array.isArray(toks)) {
        standard = "ext";
      }
    } catch {
      /* */
    }
  }

  // DIP721
  if (standard === "unknown") {
    try {
      const n = await actor.dip721_name?.();
      if (typeof n === "string" && n.length) {
        standard = "dip721";
        name = n;
      }
    } catch {
      /* */
    }
  }

  if (standard === "unknown") {
    throw new Error(
      "Could not detect ICRC-7, EXT, or DIP721 on this canister",
    );
  }

  if (!thumbnailUrl) {
    thumbnailUrl = thumbCandidates(id)[0] ?? null;
  }

  allowLedgerSpend(id);
  return {
    id,
    name,
    standard,
    thumbnailUrl,
    source: "manual",
  };
}
