import { describe, expect, it } from "vitest";
import { anonymousLedgerStorageKey, ledgerStorageKeyFor } from "../src/storage/ledger-storage";

describe("端末内の支出保存先", () => {
  it("匿名・利用者・ペアで保存先を分離する", () => {
    expect(anonymousLedgerStorageKey).not.toBe(ledgerStorageKeyFor("user-a", null));
    expect(ledgerStorageKeyFor("user-a", null)).not.toBe(ledgerStorageKeyFor("user-b", null));
    expect(ledgerStorageKeyFor("user-a", "pair-a")).not.toBe(ledgerStorageKeyFor("user-a", "pair-b"));
  });

  it("同じペアでは利用者が違っても同じ端末保存先を使う", () => {
    expect(ledgerStorageKeyFor("user-a", "pair-a")).toBe(ledgerStorageKeyFor("user-b", "pair-a"));
  });
});
