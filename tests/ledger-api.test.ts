import { describe, expect, it } from "vitest";
import { parseExpenseInput } from "../src/server/ledger-api";

describe("共有支出API", () => {
  it("個別支出と左右メモを受け付ける", () => {
    expect(parseExpenseInput({
      id: "offline-id",
      payer: "left",
      mode: "individual",
      leftAmount: 500,
      rightAmount: 800,
      leftMemo: "ランチ",
      rightMemo: "日用品",
    })).toMatchObject({
      id: "offline-id",
      payer: "left",
      mode: "individual",
      leftAmount: 500,
      rightAmount: 800,
      leftMemo: "ランチ",
      rightMemo: "日用品",
    });
  });

  it("0円や小数の支出を拒否する", () => {
    expect(parseExpenseInput({ payer: "right", mode: "split", leftAmount: 0, rightAmount: 0 })).toBeNull();
    expect(parseExpenseInput({ payer: "right", mode: "split", leftAmount: 10.5, rightAmount: 0 })).toBeNull();
  });

  it("メモを48文字に制限する", () => {
    const expense = parseExpenseInput({
      payer: "right",
      mode: "split",
      leftAmount: 100,
      rightAmount: 0,
      memo: "あ".repeat(60),
    });

    expect(expense?.memo).toHaveLength(48);
  });
});
