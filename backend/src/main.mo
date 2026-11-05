import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Text "mo:base/Text";
import Iter "mo:base/Iter";
import Array "mo:base/Array";
import HashMap "mo:base/HashMap";
import Buffer "mo:base/Buffer";

/// Canopy fee router — records micro-fees users pay explicitly.
/// Does NOT custody user balances. No private keys. Treasury receives fee legs
/// signed by the user on the ICP / ICRC ledgers; this canister only configures
/// rates and acknowledges receipts for ops / UX.
persistent actor CanopyFees {
  public type FeeKind = {
    #swap;
    #nftSend;
    #cycleTopUp;
    #ftSend;
  };

  public type FeeConfig = {
    swapFeeBps : Nat;
    nftSendFeeE8s : Nat;
    cycleMarginBps : Nat;
    treasury : Principal;
    maxSwapNotionalE8s : Nat;
    maxCycleTopUpE8s : Nat;
  };

  public type FeeReceipt = {
    id : Nat;
    payer : Principal;
    kind : FeeKind;
    amountE8s : Nat;
    memo : Text;
    at : Int;
    ledgerBlock : ?Nat;
  };

  public type PairLpCredit = {
    tokenIn : Text;
    tokenOut : Text;
    feeLedger : Text;
    amount : Nat;
    updatedAt : Int;
  };

  /// Bazaar treasury (mint / market proceeds).
  let DEFAULT_TREASURY : Principal = Principal.fromText("j7j3j-2iaaa-aaaau-agwla-cai");

  /// Deployer / ops controller — restored on upgrade if owner was never claimed.
  let BOOTSTRAP_OWNER : Principal = Principal.fromText("kvn5d-w5oba-kyppl-ffjvv-bzgqz-cei77-pqypp-w4u64-gpzse-7r4ex-7qe");

  let MAX_RECEIPTS : Nat = 5_000;
  let MAX_PAIR_LP_KEYS : Nat = 2_000;
  let MAX_NFT_SEND_FEE_E8S : Nat = 100_000_000; // 1 ICP

  var owner : Principal = BOOTSTRAP_OWNER;
  var config : FeeConfig = {
    swapFeeBps = 20;
    nftSendFeeE8s = 10_000;
    cycleMarginBps = 25;
    treasury = DEFAULT_TREASURY;
    maxSwapNotionalE8s = 1_000_000_000_000_000_000;
    maxCycleTopUpE8s = 10_000_000_000;
  };

  var ftSendFeeBps : Nat = 15;

  var nextReceiptId : Nat = 1;
  var receiptEntries : [(Nat, FeeReceipt)] = [];
  var totalFeesE8s : Nat = 0;
  var totalReceipts : Nat = 0;

  var pairLpEntries : [(Text, PairLpCredit)] = [];

  transient var receipts = HashMap.HashMap<Nat, FeeReceipt>(
    64,
    Nat.equal,
    func(n : Nat) : Nat32 { Nat32.fromNat(n % 4_294_967_296) },
  );

  transient var pairLp = HashMap.HashMap<Text, PairLpCredit>(
    32,
    Text.equal,
    Text.hash,
  );

  system func preupgrade() {
    receiptEntries := Iter.toArray(receipts.entries());
    pairLpEntries := Iter.toArray(pairLp.entries());
  };

  system func postupgrade() {
    if (Principal.equal(owner, Principal.fromText("aaaaa-aa"))) {
      owner := BOOTSTRAP_OWNER;
    };
    receipts := HashMap.fromIter<Nat, FeeReceipt>(
      receiptEntries.vals(),
      receiptEntries.size(),
      Nat.equal,
      func(n : Nat) : Nat32 { Nat32.fromNat(n % 4_294_967_296) },
    );
    receiptEntries := [];
    pairLp := HashMap.fromIter<Text, PairLpCredit>(
      pairLpEntries.vals(),
      pairLpEntries.size(),
      Text.equal,
      Text.hash,
    );
    pairLpEntries := [];
  };

  func requireOwner(caller : Principal) : { #ok; #err : Text } {
    if (Principal.isAnonymous(caller)) {
      return #err "Anonymous";
    };
    if (not Principal.equal(caller, owner)) {
      return #err "Not owner";
    };
    #ok
  };

  public shared ({ caller }) func setConfig(next : FeeConfig) : async { #ok; #err : Text } {
    switch (requireOwner(caller)) {
      case (#err e) { return #err e };
      case (#ok) {};
    };
    if (next.swapFeeBps > 500) {
      return #err "swapFeeBps max 500 (5%)";
    };
    if (next.cycleMarginBps > 1_000) {
      return #err "cycleMarginBps max 1000 (10%)";
    };
    if (next.nftSendFeeE8s > MAX_NFT_SEND_FEE_E8S) {
      return #err "nftSendFeeE8s max 1 ICP";
    };
    if (Principal.isAnonymous(next.treasury)) {
      return #err "Invalid treasury";
    };
    config := next;
    #ok
  };

  public shared ({ caller }) func transferOwnership(next : Principal) : async { #ok; #err : Text } {
    switch (requireOwner(caller)) {
      case (#err e) { return #err e };
      case (#ok) {};
    };
    if (Principal.isAnonymous(next)) {
      return #err "Invalid owner";
    };
    owner := next;
    #ok
  };

  public shared ({ caller }) func setFtSendFeeBps(bps : Nat) : async { #ok; #err : Text } {
    switch (requireOwner(caller)) {
      case (#err e) { return #err e };
      case (#ok) {};
    };
    if (bps > 500) { return #err "ftSendFeeBps max 500" };
    ftSendFeeBps := bps;
    #ok
  };

  public query func getFtSendFeeBps() : async Nat {
    ftSendFeeBps
  };

  public query func getConfig() : async FeeConfig {
    config
  };

  public query func getOwner() : async Principal {
    owner
  };

  public query func getStats() : async {
    totalFeesE8s : Nat;
    totalReceipts : Nat;
  } {
    { totalFeesE8s; totalReceipts }
  };

  public query func quoteSwapFee(notionalE8s : Nat) : async {
    #ok : { feeE8s : Nat; treasury : Principal };
    #err : Text;
  } {
    if (notionalE8s == 0) {
      return #err "Zero notional";
    };
    let fee = (notionalE8s * config.swapFeeBps) / 10_000;
    #ok { feeE8s = fee; treasury = config.treasury }
  };

  public query func quoteFtSendFee(amount : Nat) : async {
    #ok : { feeAmount : Nat; bps : Nat; treasury : Principal };
    #err : Text;
  } {
    if (amount == 0) { return #err "Zero amount" };
    let fee = (amount * ftSendFeeBps) / 10_000;
    #ok { feeAmount = fee; bps = ftSendFeeBps; treasury = config.treasury }
  };

  public query func quoteNftSendFee() : async {
    feeE8s : Nat;
    treasury : Principal;
  } {
    { feeE8s = config.nftSendFeeE8s; treasury = config.treasury }
  };

  /// Tiered bulk discount on stacked per-NFT micro-fees.
  /// 1: 0% · 2–4: 5% · 5–9: 10% · 10–24: 15% · 25–49: 20% · 50+: 25%
  func nftBulkDiscountBps(count : Nat) : Nat {
    if (count >= 50) { 2_500 } else if (count >= 25) { 2_000 } else if (count >= 10) {
      1_500
    } else if (count >= 5) { 1_000 } else if (count >= 2) { 500 } else { 0 }
  };

  let MAX_NFT_BULK_SEND : Nat = 200;

  public query func quoteNftSendBulkFee(count : Nat) : async {
    #ok : {
      unitFeeE8s : Nat;
      count : Nat;
      subtotalE8s : Nat;
      discountBps : Nat;
      discountE8s : Nat;
      feeE8s : Nat;
      treasury : Principal;
    };
    #err : Text;
  } {
    if (count == 0) { return #err "Zero count" };
    if (count > MAX_NFT_BULK_SEND) {
      return #err "Max 200 NFTs per bulk send";
    };
    let unit = config.nftSendFeeE8s;
    let subtotal = unit * count;
    let discountBps = nftBulkDiscountBps(count);
    let discountE8s = (subtotal * discountBps) / 10_000;
    let feeE8s = Nat.sub(subtotal, discountE8s);
    #ok {
      unitFeeE8s = unit;
      count;
      subtotalE8s = subtotal;
      discountBps;
      discountE8s;
      feeE8s;
      treasury = config.treasury;
    }
  };

  public query func quoteCycleMargin(icpE8s : Nat) : async {
    #ok : { marginE8s : Nat; treasury : Principal };
    #err : Text;
  } {
    if (icpE8s == 0) {
      return #err "Zero amount";
    };
    if (icpE8s > config.maxCycleTopUpE8s) {
      return #err "Above max cycle top-up";
    };
    let margin = (icpE8s * config.cycleMarginBps) / 10_000;
    #ok { marginE8s = margin; treasury = config.treasury }
  };

  public shared ({ caller }) func recordPairLpCredit(
    tokenIn : Text,
    tokenOut : Text,
    feeLedger : Text,
    amount : Nat,
  ) : async { #ok; #err : Text } {
    if (Principal.isAnonymous(caller)) { return #err "Anonymous" };
    if (amount == 0) { return #err "Zero amount" };
    if (Text.size(tokenIn) > 80 or Text.size(tokenOut) > 80 or Text.size(feeLedger) > 80) {
      return #err "Id too long";
    };
    let key = tokenIn # "|" # tokenOut # "|" # feeLedger;
    switch (pairLp.get(key)) {
      case (?prev) {
        pairLp.put(key, {
          tokenIn;
          tokenOut;
          feeLedger;
          amount = prev.amount + amount;
          updatedAt = Time.now();
        });
      };
      case null {
        if (pairLp.size() >= MAX_PAIR_LP_KEYS) {
          return #err "Pair LP map full";
        };
        pairLp.put(key, {
          tokenIn;
          tokenOut;
          feeLedger;
          amount;
          updatedAt = Time.now();
        });
      };
    };
    #ok
  };

  public shared ({ caller }) func consumePairLpCredit(
    tokenIn : Text,
    tokenOut : Text,
    feeLedger : Text,
    amount : Nat,
  ) : async { #ok; #err : Text } {
    switch (requireOwner(caller)) {
      case (#err e) { return #err e };
      case (#ok) {};
    };
    if (amount == 0) { return #err "Zero amount" };
    let key = tokenIn # "|" # tokenOut # "|" # feeLedger;
    switch (pairLp.get(key)) {
      case null { return #err "No credit for pair" };
      case (?prev) {
        if (amount > prev.amount) { return #err "Amount exceeds credit" };
        let next = Nat.sub(prev.amount, amount);
        if (next == 0) {
          pairLp.delete(key);
        } else {
          pairLp.put(key, {
            tokenIn = prev.tokenIn;
            tokenOut = prev.tokenOut;
            feeLedger = prev.feeLedger;
            amount = next;
            updatedAt = Time.now();
          });
        };
      };
    };
    #ok
  };

  public query func listPairLpCredits(limit : Nat) : async [PairLpCredit] {
    let lim = if (limit == 0 or limit > 200) { 200 } else { limit };
    let buf = Buffer.Buffer<PairLpCredit>(lim);
    var i = 0;
    label push for ((_, c) in pairLp.entries()) {
      if (i >= lim) { break push };
      buf.add(c);
      i += 1;
    };
    Buffer.toArray(buf)
  };

  public shared ({ caller }) func recordFeePayment(
    kind : FeeKind,
    amountE8s : Nat,
    memo : Text,
    ledgerBlock : ?Nat,
  ) : async { #ok : Nat; #err : Text } {
    if (Principal.isAnonymous(caller)) {
      return #err "Anonymous";
    };
    if (amountE8s == 0) {
      return #err "Zero amount";
    };
    if (Text.size(memo) > 200) {
      return #err "Memo too long";
    };
    if (receipts.size() >= MAX_RECEIPTS) {
      return #err "Receipt log full";
    };
    let id = nextReceiptId;
    nextReceiptId += 1;
    let receipt : FeeReceipt = {
      id;
      payer = caller;
      kind;
      amountE8s;
      memo;
      at = Time.now();
      ledgerBlock;
    };
    receipts.put(id, receipt);
    totalFeesE8s += amountE8s;
    totalReceipts += 1;
    #ok id
  };

  public query func listRecentReceipts(limit : Nat) : async [FeeReceipt] {
    let lim = if (limit == 0 or limit > 100) { 100 } else { limit };
    let buf = Buffer.Buffer<FeeReceipt>(lim);
    let all = Iter.toArray(receipts.entries());
    let sorted = Array.sort<(Nat, FeeReceipt)>(
      all,
      func(a, b) { Nat.compare(b.0, a.0) },
    );
    var i = 0;
    label push for ((_, r) in sorted.vals()) {
      if (i >= lim) { break push };
      buf.add(r);
      i += 1;
    };
    Buffer.toArray(buf)
  };
};
