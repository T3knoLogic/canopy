/**
 * List Bazaar Market–compliant ICRC-7 NFTs from Canopy (II-signed).
 * Purchases stay on the Bazaar market page — this only creates listings.
 */
import { Actor, HttpAgent, type Identity } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import {
  BAZAAR_MARKETPLACE,
  BAZAAR_SHARED_LEDGER,
  IC_HOST,
} from "./constants";

const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

const marketplaceIdl: IDL.InterfaceFactory = ({ IDL: I }) =>
  I.Service({
    createListing: I.Func([I.Nat, I.Nat, I.Nat], [I.Opt(I.Nat)], []),
  });

const sharedLedgerIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Value = I.Variant({
    Nat: I.Nat,
    Int: I.Int,
    Text: I.Text,
    Blob: I.Vec(I.Nat8),
  });
  void Value;
  return I.Service({
    icrc37_approve: I.Func(
      [
        I.Vec(
          I.Record({
            token_id: I.Nat,
            approval_info: I.Record({
              from_subaccount: I.Opt(I.Vec(I.Nat8)),
              spender: Account,
              memo: I.Opt(I.Vec(I.Nat8)),
              expires_at: I.Opt(I.Nat64),
              created_at_time: I.Opt(I.Nat64),
            }),
          }),
        ),
      ],
      [
        I.Vec(
          I.Opt(
            I.Variant({
              Ok: I.Nat,
              Err: I.Variant({
                Unauthorized: I.Null,
                NonExistingTokenId: I.Null,
                TooOld: I.Null,
                CreatedInFuture: I.Record({ ledger_time: I.Nat64 }),
                GenericError: I.Record({ error_code: I.Nat, message: I.Text }),
                Duplicate: I.Record({ duplicate_of: I.Nat }),
                GenericBatchError: I.Record({
                  error_code: I.Nat,
                  message: I.Text,
                }),
                ApprovalError: I.Null,
              }),
            }),
          ),
        ),
      ],
      [],
    ),
  });
};

const partnerApproveIdl: IDL.InterfaceFactory = ({ IDL: I }) =>
  I.Service({
    icrc37_approve_tokens: I.Func(
      [
        I.Vec(
          I.Record({
            token_id: I.Nat,
            approval_info: I.Record({
              from_subaccount: I.Opt(I.Vec(I.Nat8)),
              spender: Account,
              memo: I.Opt(I.Vec(I.Nat8)),
              expires_at: I.Opt(I.Nat64),
              created_at_time: I.Opt(I.Nat64),
            }),
          }),
        ),
      ],
      [
        I.Vec(
          I.Opt(
            I.Variant({
              Ok: I.Nat,
              Err: I.Text,
            }),
          ),
        ),
      ],
      [],
    ),
  });

export function isBazaarListable(nft: {
  standard: string;
  bazaarCollectionId?: string | null;
  contractId: string;
}): boolean {
  if (nft.standard !== "icrc7") return false;
  if (nft.bazaarCollectionId && /^\d+$/.test(nft.bazaarCollectionId)) return true;
  // Shared multi-series ledger needs an explicit registry collection id.
  if (nft.contractId === BAZAAR_SHARED_LEDGER) return false;
  // Dedicated / partner ICRC-7 — resolve collection id from registry at list time.
  return true;
}

async function identityAgent(identity: Identity): Promise<HttpAgent> {
  return HttpAgent.create({ identity, host: IC_HOST });
}

async function approveMarketplace(
  identity: Identity,
  tokenId: bigint,
  ledgerId: string,
): Promise<void> {
  const agent = await identityAgent(identity);
  const spender = {
    owner: Principal.fromText(BAZAAR_MARKETPLACE),
    subaccount: [] as [],
  };
  const approvalInfo = {
    from_subaccount: [] as [],
    spender,
    memo: [] as [],
    expires_at: [] as [],
    created_at_time: [] as [],
  };

  try {
    const ledger = Actor.createActor(sharedLedgerIdl, {
      agent,
      canisterId: ledgerId,
    });
    await ledger.icrc37_approve([{ token_id: tokenId, approval_info: approvalInfo }]);
    return;
  } catch {
    /* partner path */
  }

  const partner = Actor.createActor(partnerApproveIdl, {
    agent,
    canisterId: ledgerId,
  });
  await partner.icrc37_approve_tokens([
    { token_id: tokenId, approval_info: approvalInfo },
  ]);
}

/**
 * Approve marketplace spender + createListing.
 * collectionId = Bazaar registry collection nat (required).
 */
export async function listBazaarNftFromCanopy(params: {
  identity: Identity;
  collectionId: bigint;
  tokenId: bigint;
  priceE8s: bigint;
  ledgerCanisterId: string;
  onProgress?: (msg: string) => void;
}): Promise<bigint> {
  const progress = params.onProgress ?? (() => {});
  if (params.priceE8s <= 0n) throw new Error("Price must be greater than 0");
  if (params.priceE8s > 10_000_000_000_000n) {
    throw new Error("Price exceeds safety cap (100_000 ICP)");
  }

  progress("Approving Bazaar marketplace…");
  await approveMarketplace(
    params.identity,
    params.tokenId,
    params.ledgerCanisterId || BAZAAR_SHARED_LEDGER,
  );

  progress("Creating listing…");
  const agent = await identityAgent(params.identity);
  const marketplace = Actor.createActor(marketplaceIdl, {
    agent,
    canisterId: BAZAAR_MARKETPLACE,
  });
  const result = (await marketplace.createListing(
    params.collectionId,
    params.tokenId,
    params.priceE8s,
  )) as [] | [bigint];
  if (!result.length) {
    throw new Error(
      "Listing rejected — confirm you own this NFT and it is not already listed",
    );
  }
  return result[0]!;
}

export function icpToE8s(icp: string): bigint {
  const t = icp.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(t)) throw new Error("Invalid ICP amount");
  const [w, f = ""] = t.split(".");
  const frac = (f + "00000000").slice(0, 8);
  return BigInt(w) * 100_000_000n + BigInt(frac);
}
