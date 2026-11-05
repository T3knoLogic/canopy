/**
 * Resolve Bazaar registry collectionId for a ledger (+ optional name hint).
 * Cached in-memory for the session.
 */
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { BAZAAR_REGISTRY, IC_HOST } from "./constants";

type Row = {
  id: bigint;
  ledger: { toText: () => string };
  name: string;
  status: object;
};

let cache: Map<string, { id: string; name: string }[]> | null = null;

async function loadRegistry(): Promise<Map<string, { id: string; name: string }[]>> {
  if (cache) return cache;
  const agent = await HttpAgent.create({ host: IC_HOST });
  const CollectionStatus = IDL.Variant({
    Draft: IDL.Null,
    Live: IDL.Null,
    Paused: IDL.Null,
  });
  const RwaStatus = IDL.Variant({
    None: IDL.Null,
    Pending: IDL.Null,
    Certified: IDL.Null,
    Rejected: IDL.Null,
    Revoked: IDL.Null,
  });
  const Standard = IDL.Variant({
    ICRC7: IDL.Null,
    EXT: IDL.Null,
    DIP721: IDL.Null,
    Custom: IDL.Null,
  });
  const CollectionRecordIdl = IDL.Record({
    id: IDL.Nat,
    ledger: IDL.Principal,
    standard: Standard,
    name: IDL.Text,
    symbol: IDL.Text,
    creator: IDL.Principal,
    royaltyBps: IDL.Nat,
    maxSupply: IDL.Nat,
    minted: IDL.Nat,
    featured: IDL.Bool,
    verified: IDL.Bool,
    status: CollectionStatus,
    bannerUrl: IDL.Text,
    description: IDL.Text,
    floorPriceE8s: IDL.Nat,
    listedCount: IDL.Nat,
    volumeE8s: IDL.Nat,
    tags: IDL.Vec(IDL.Text),
    rwaStatus: RwaStatus,
    rwaCertified: IDL.Bool,
    rwaEvidenceUri: IDL.Opt(IDL.Text),
    rwaEvidenceHash: IDL.Opt(IDL.Text),
    rwaReviewerNote: IDL.Opt(IDL.Text),
    rwaCertifiedAt: IDL.Opt(IDL.Nat64),
    rwaCertifiedBy: IDL.Opt(IDL.Principal),
    registryEntryId: IDL.Opt(IDL.Nat),
    shopifyProductHandle: IDL.Opt(IDL.Text),
  });
  const actor = Actor.createActor(
    () =>
      IDL.Service({
        listCollections: IDL.Func(
          [IDL.Nat, IDL.Nat],
          [IDL.Vec(CollectionRecordIdl)],
          ["query"],
        ),
      }),
    { agent, canisterId: BAZAAR_REGISTRY },
  ) as { listCollections: (o: bigint, l: bigint) => Promise<Row[]> };

  const byLedger = new Map<string, { id: string; name: string }[]>();
  for (let page = 0; page < 1_000; page++) {
    const rows = await actor.listCollections(BigInt(page * 100), 100n);
    if (!rows.length) break;
    for (const row of rows) {
      const statusKey = Object.keys(row.status || {})[0];
      if (statusKey === "Draft") continue;
      const ledger = row.ledger.toText();
      const list = byLedger.get(ledger) ?? [];
      list.push({ id: row.id.toString(), name: row.name });
      byLedger.set(ledger, list);
    }
    if (rows.length < 100) break;
  }
  cache = byLedger;
  return byLedger;
}

/** Best registry collection id for this NFT (fills missing bazaarCollectionId). */
export async function resolveBazaarCollectionId(nft: {
  contractId: string;
  bazaarCollectionId?: string | null;
  collectionName?: string | null;
}): Promise<string | null> {
  if (nft.bazaarCollectionId && /^\d+$/.test(nft.bazaarCollectionId)) {
    return nft.bazaarCollectionId;
  }
  try {
    const map = await loadRegistry();
    const rows = map.get(nft.contractId) ?? [];
    if (!rows.length) return null;
    if (rows.length === 1) return rows[0]!.id;
    const hint = nft.collectionName?.trim().toLowerCase();
    if (hint) {
      const hit = rows.find((r) => r.name.toLowerCase() === hint);
      if (hit) return hit.id;
    }
    return rows[0]!.id;
  } catch {
    return null;
  }
}
