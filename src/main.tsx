import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  calculateLedger,
  getExpenseTotal,
  isValidExpense,
  moveOldestToBase,
  type AllocationMode,
  type Expense,
  type LedgerBase,
  type Participant,
} from "./domain/ledger";
import "./styles.css";

const storageKey = "paybalance-demo-ledger";

type AppState = { expenses: Expense[]; base: LedgerBase };

const initialState: AppState = {
  base: { leftNet: 0, lastOddExtra: null },
  expenses: [
    { id: "sample-1", payer: "right", mode: "split", leftAmount: 570, rightAmount: 0, memo: "コメダ" },
    { id: "sample-2", payer: "left", mode: "individual", leftAmount: 0, rightAmount: 1258, memo: "ドトール" },
  ],
};

const participantNames: Record<Participant, string> = { left: "はなこ", right: "たろう" };

const loadState = (): AppState => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return initialState;
    return JSON.parse(saved) as AppState;
  } catch {
    return initialState;
  }
};

const formatYen = (amount: number) => `${amount.toLocaleString("ja-JP")}円`;

function App() {
  const [appState, setAppState] = useState<AppState>(loadState);
  const [payer, setPayer] = useState<Participant>("right");
  const [mode, setMode] = useState<AllocationMode>("individual");
  const [leftAmount, setLeftAmount] = useState("");
  const [rightAmount, setRightAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");

  const ledger = useMemo(
    () => calculateLedger(appState.expenses, appState.base),
    [appState],
  );

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(appState));
  }, [appState]);

  useEffect(() => {
    setPayer(ledger.nextPayer);
  }, [ledger.nextPayer]);

  const amountFor = (value: string) => (value === "" ? 0 : Number(value));
  const total = amountFor(leftAmount) + amountFor(rightAmount);

  const addExpense = (event: React.FormEvent) => {
    event.preventDefault();
    const expense: Expense = {
      id: crypto.randomUUID(),
      payer,
      mode,
      leftAmount: amountFor(leftAmount),
      rightAmount: amountFor(rightAmount),
      memo: memo.trim(),
    };

    if (!isValidExpense(expense)) {
      setMessage("金額は1円以上の整数で入力してください。");
      return;
    }

    setAppState((current) => {
      const added = [...current.expenses, expense];
      const trimmed = moveOldestToBase(current.base, added);
      return trimmed;
    });
    setLeftAmount("");
    setRightAmount("");
    setMemo("");
    setMessage("支払いを記録しました。");
  };

  const deleteExpense = (id: string) => {
    setAppState((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => expense.id !== id),
    }));
    setMessage("記録を削除しました。");
  };

  const selectedName = participantNames[payer];

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PayBalance ホーム">PayBalance</a>
        <button className="settings-button" type="button" aria-label="設定を開く">設定</button>
      </header>

      <section className="balance-panel" aria-label="現在の支払いバランス">
        <div className="balance-copy">
          <p>次に支払う人</p>
          <strong>{participantNames[ledger.nextPayer]}</strong>
        </div>
        <div className="difference-copy">
          <p>差分</p>
          <strong>{formatYen(ledger.difference)}</strong>
        </div>
      </section>

      <form className="entry-form" onSubmit={addExpense}>
        <div className="section-heading">
          <span>払う人</span>
          <div className="segmented" aria-label="支払う人">
            {(["left", "right"] as const).map((participant) => (
              <button
                className={payer === participant ? `person-${participant} selected` : `person-${participant}`}
                key={participant}
                onClick={() => setPayer(participant)}
                type="button"
              >
                {participantNames[participant]}
              </button>
            ))}
          </div>
        </div>

        <div className="mode-row">
          <div className="mode-switch" aria-label="負担方式">
            <button className={mode === "individual" ? "active" : ""} onClick={() => setMode("individual")} type="button">個別</button>
            <button className={mode === "split" ? "active" : ""} onClick={() => setMode("split")} type="button">一括</button>
          </div>
        </div>

        {mode === "individual" ? (
          <div className="amount-grid">
            {(["left", "right"] as const).map((participant) => (
              <label className={`amount-field person-${participant}`} key={participant}>
                <span>{participantNames[participant]}</span>
                <div>
                  <input
                    aria-label={`${participantNames[participant]}の負担額`}
                    inputMode="numeric"
                    min="0"
                    onChange={(event) => participant === "left" ? setLeftAmount(event.target.value) : setRightAmount(event.target.value)}
                    pattern="[0-9]*"
                    placeholder="0"
                    type="number"
                    value={participant === "left" ? leftAmount : rightAmount}
                  />
                  <small>円</small>
                </div>
              </label>
            ))}
          </div>
        ) : (
          <label className="total-field">
            <span>合計金額</span>
            <div>
              <input
                aria-label="合計金額"
                inputMode="numeric"
                min="1"
                onChange={(event) => { setLeftAmount(event.target.value); setRightAmount(""); }}
                pattern="[0-9]*"
                placeholder="0"
                type="number"
                value={leftAmount}
              />
              <small>円</small>
            </div>
          </label>
        )}

        <label className="memo-field">
          <span>メモ（任意）</span>
          <input maxLength={48} onChange={(event) => setMemo(event.target.value)} placeholder="例：ドトール" value={memo} />
        </label>
        <button className="save-button" type="submit">{formatYen(total || 0)} を記録</button>
        {message && <p className="form-message" role="status">{message}</p>}
      </form>

      <section className="history" aria-label="最近の支払い">
        <div className="history-title"><h1>最近の支払い</h1><span>最新10件</span></div>
        {appState.expenses.length === 0 ? (
          <p className="empty-state">まだ記録がありません。</p>
        ) : (
          <ul>
            {[...appState.expenses].reverse().map((expense) => (
              <li key={expense.id}>
                <div className="history-detail">
                  <strong>{formatYen(getExpenseTotal(expense))}</strong>
                  {expense.memo && <span>{expense.memo}</span>}
                </div>
                <span className={`payer-badge person-${expense.payer}`} aria-label={`${participantNames[expense.payer]}が支払いました`}>
                  <span>{expense.payer === "left" ? "L" : "R"}</span>
                </span>
                <button className="delete-button" onClick={() => deleteExpense(expense.id)} type="button">削除</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="sync-status">この端末に保存中</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
