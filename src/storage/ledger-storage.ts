const prefix = "paybalance-ledger";

// Keep the original anonymous key so existing on-device histories remain available.
export const anonymousLedgerStorageKey = "paybalance-demo-ledger";

export const ledgerStorageKeyFor = (userId: string, pairId: string | null) =>
  pairId ? `${prefix}:pair:${pairId}` : `${prefix}:user:${userId}`;
