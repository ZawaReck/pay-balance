export type Participant = "left" | "right";
export type AllocationMode = "individual" | "split";

export interface Expense {
  id: string;
  payer: Participant;
  mode: AllocationMode;
  leftAmount: number;
  rightAmount: number;
  memo: string;
  leftMemo?: string;
  rightMemo?: string;
}

export interface LedgerBase {
  leftNet: number;
  lastOddExtra: Participant | null;
}

export interface LedgerResult extends LedgerBase {
  rightNet: number;
  nextPayer: Participant;
  difference: number;
}

const opposite = (participant: Participant): Participant =>
  participant === "left" ? "right" : "left";

export const getExpenseTotal = (expense: Expense): number =>
  expense.leftAmount + expense.rightAmount;

export const getExpenseMemo = (expense: Expense, participant: Participant): string => {
  if (expense.mode === "split") {
    return expense.payer === participant ? expense.memo : "";
  }

  const participantMemo = participant === "left" ? expense.leftMemo : expense.rightMemo;
  return participantMemo ?? (expense.payer === participant ? expense.memo : "");
};

export const isValidExpense = (expense: Expense): boolean => {
  if (!Number.isInteger(expense.leftAmount) || !Number.isInteger(expense.rightAmount)) {
    return false;
  }

  return expense.leftAmount >= 0 && expense.rightAmount >= 0 && getExpenseTotal(expense) > 0;
};

export const getBurden = (
  expense: Expense,
  previousOddExtra: Participant | null,
): { left: number; right: number; oddExtra: Participant | null } => {
  if (expense.mode === "individual") {
    return {
      left: expense.leftAmount,
      right: expense.rightAmount,
      oddExtra: previousOddExtra,
    };
  }

  const total = getExpenseTotal(expense);
  const half = Math.floor(total / 2);
  if (total % 2 === 0) {
    return { left: half, right: half, oddExtra: previousOddExtra };
  }

  const oddExtra = previousOddExtra === null ? opposite(expense.payer) : opposite(previousOddExtra);
  return {
    left: half + (oddExtra === "left" ? 1 : 0),
    right: half + (oddExtra === "right" ? 1 : 0),
    oddExtra,
  };
};

export const applyExpense = (base: LedgerBase, expense: Expense): LedgerBase => {
  const burden = getBurden(expense, base.lastOddExtra);
  const total = getExpenseTotal(expense);
  const paidByLeft = expense.payer === "left" ? total : 0;

  return {
    leftNet: base.leftNet + paidByLeft - burden.left,
    lastOddExtra: burden.oddExtra,
  };
};

export const calculateLedger = (
  expenses: Expense[],
  base: LedgerBase = { leftNet: 0, lastOddExtra: null },
  rightParticipant: Participant = "right",
): LedgerResult => {
  const calculated = expenses.reduce(applyExpense, base);
  const rightNet = -calculated.leftNet;

  return {
    ...calculated,
    rightNet,
    nextPayer:
      calculated.leftNet === 0
        ? rightParticipant
        : calculated.leftNet > 0
          ? "right"
          : "left",
    difference: Math.abs(calculated.leftNet),
  };
};

export const moveOldestToBase = (base: LedgerBase, expenses: Expense[]) => {
  if (expenses.length <= 10) {
    return { base, expenses };
  }

  const [oldest, ...remaining] = expenses;
  return { base: applyExpense(base, oldest), expenses: remaining };
};
