import { describe, expect, it } from "vitest";
import { calculateLedger, getBurden, getExpenseMemo, moveOldestToBase, type Expense } from "../src/domain/ledger";

const split = (payer: "left" | "right", total: number): Expense => ({
  id: crypto.randomUUID(),
  payer,
  mode: "split",
  leftAmount: total,
  rightAmount: 0,
  memo: "",
});

describe("支払いバランス", () => {
  it("最初の奇数一括支出では支払っていない側の負担を1円多くする", () => {
    const result = calculateLedger([split("left", 2001)]);

    expect(result.nextPayer).toBe("right");
    expect(result.difference).toBe(1001);
    expect(result.lastOddExtra).toBe("right");
  });

  it("次の奇数一括支出では端数の負担者を交代させる", () => {
    const first = split("left", 2001);
    const second = split("right", 2001);
    const result = calculateLedger([first, second]);

    expect(getBurden(first, null)).toMatchObject({ left: 1000, right: 1001 });
    expect(getBurden(second, "right")).toMatchObject({ left: 1001, right: 1000 });
    expect(result.difference).toBe(0);
    expect(result.nextPayer).toBe("right");
  });

  it("個別負担では空欄相当の0円を受け付ける", () => {
    const result = calculateLedger([
      {
        id: "solo",
        payer: "left",
        mode: "individual",
        leftAmount: 0,
        rightAmount: 1000,
        memo: "プレゼント",
      },
    ]);

    expect(result.difference).toBe(1000);
    expect(result.nextPayer).toBe("right");
  });

  it("残高が同額なら画面右側の人を次の支払者にする", () => {
    const result = calculateLedger([], { leftNet: 0, lastOddExtra: null }, "left");

    expect(result.nextPayer).toBe("left");
  });

  it("個別負担のメモを左右それぞれに保持する", () => {
    const expense: Expense = {
      id: "individual-memos",
      payer: "right",
      mode: "individual",
      leftAmount: 500,
      rightAmount: 800,
      memo: "",
      leftMemo: "ランチ",
      rightMemo: "日用品",
    };

    expect(getExpenseMemo(expense, "left")).toBe("ランチ");
    expect(getExpenseMemo(expense, "right")).toBe("日用品");
  });

  it("旧形式の個別メモは支払者側に表示する", () => {
    const expense: Expense = {
      id: "legacy-memo",
      payer: "left",
      mode: "individual",
      leftAmount: 500,
      rightAmount: 0,
      memo: "交通費",
    };

    expect(getExpenseMemo(expense, "left")).toBe("交通費");
    expect(getExpenseMemo(expense, "right")).toBe("");
  });

  it("11件目では最古の明細だけを累積値へ移す", () => {
    const expenses = Array.from({ length: 11 }, (_, index) => ({
      ...split(index % 2 === 0 ? "left" : "right", 101),
      id: `expense-${index + 1}`,
    }));

    const compacted = moveOldestToBase({ leftNet: 0, lastOddExtra: null }, expenses);

    expect(compacted.expenses).toHaveLength(10);
    expect(compacted.expenses[0].id).toBe("expense-2");
    expect(compacted.base).toEqual({ leftNet: 51, lastOddExtra: "right" });
  });
});
