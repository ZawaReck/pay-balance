import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  calculateLedger,
  getBurden,
  getExpenseMemo,
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

type AppState = {
  expenses: Expense[];
  base: LedgerBase;
  names: Record<Participant, string>;
  leftOnLeft: boolean;
};

type CurrentUser = { id: string; displayName: string };
type PairState = {
  pair: {
    id: string;
    left: CurrentUser;
    right: CurrentUser;
  } | null;
  invitation: { id: string; invitedEmail: string; expiresAt: string } | null;
};

type InvitationDetails = { inviterName: string; expiresAt: string };
type SharedLedger = {
  pair: NonNullable<PairState["pair"]>;
  base: LedgerBase;
  expenses: Expense[];
};

const initialState: AppState = {
  base: { leftNet: 0, lastOddExtra: null },
  names: { left: "はなこ", right: "たろう" },
  leftOnLeft: true,
  expenses: [
    { id: "sample-1", payer: "right", mode: "split", leftAmount: 570, rightAmount: 0, memo: "コメダ" },
    { id: "sample-2", payer: "left", mode: "individual", leftAmount: 0, rightAmount: 1258, memo: "", rightMemo: "ドトール" },
  ],
};

const loadState = (): AppState => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return initialState;
    return { ...initialState, ...JSON.parse(saved) } as AppState;
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
  const [leftMemo, setLeftMemo] = useState("");
  const [rightMemo, setRightMemo] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealedExpenseId, setRevealedExpenseId] = useState<string | null>(null);
  const touchStart = useRef<{ id: string; x: number } | null>(null);
  const suppressedClickId = useRef<string | null>(null);
  const syncingExpenses = useRef(false);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"home" | "settings">("home");
  const [authenticatedUser, setAuthenticatedUser] = useState<CurrentUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [pairState, setPairState] = useState<PairState | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitationDetails, setInvitationDetails] = useState<InvitationDetails | null>(null);
  const [invitationError, setInvitationError] = useState("");
  const invitationToken = location.pathname.match(/^\/invitations\/([^/]+)$/)?.[1] ?? null;

  const ledger = useMemo(
    () => calculateLedger(appState.expenses, appState.base, appState.leftOnLeft ? "right" : "left"),
    [appState],
  );

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(appState));
  }, [appState]);

  useEffect(() => {
    setPayer(ledger.nextPayer);
  }, [ledger.nextPayer]);

  useEffect(() => {
    fetch("/api/me")
      .then((response) => response.ok ? response.json() as Promise<{ user?: CurrentUser }> : null)
      .then((data: { user?: CurrentUser } | null) => setAuthenticatedUser(data?.user ?? null))
      .catch(() => setAuthenticatedUser(null))
      .finally(() => setAuthLoaded(true));
  }, []);

  const loadPairState = () => fetch("/api/pair")
    .then(async (response) => {
      if (!response.ok) throw new Error((await response.json<{ error?: string }>()).error ?? "ペア情報を取得できませんでした。");
      return response.json<PairState>();
    })
    .then((state) => {
      setPairState(state);
      if (state.pair) {
        setAppState((current) => ({
          ...current,
          names: { left: state.pair!.left.displayName, right: state.pair!.right.displayName },
        }));
      }
    })
    .catch((error) => setMessage(error instanceof Error ? error.message : "ペア情報を取得できませんでした。"));

  const applySharedLedger = (ledgerState: SharedLedger) => {
    setAppState((current) => {
      const serverIds = new Set(ledgerState.expenses.map((expense) => expense.id));
      const pending = current.expenses.filter((expense) => expense.pending && !serverIds.has(expense.id));
      return {
        ...current,
        base: ledgerState.base,
        expenses: [...ledgerState.expenses, ...pending],
        names: {
          left: ledgerState.pair.left.displayName,
          right: ledgerState.pair.right.displayName,
        },
      };
    });
  };

  const refreshSharedLedger = async () => {
    const response = await fetch("/api/ledger");
    const data = await response.json<SharedLedger & { error?: string }>();
    if (!response.ok) throw new Error(data.error ?? "共有データを取得できませんでした。");
    applySharedLedger(data);
  };

  const synchronizeExpenses = async (expenses: Expense[]) => {
    if (!pairState?.pair || syncingExpenses.current || !navigator.onLine || expenses.length === 0) return;
    syncingExpenses.current = true;
    try {
      for (const expense of expenses) {
        const response = await fetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...expense, pending: undefined, version: undefined }),
        });
        if (!response.ok) {
          const data = await response.json<{ error?: string }>();
          throw new Error(data.error ?? "支出を同期できませんでした。");
        }
      }
      await refreshSharedLedger();
      setMessage("同期しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "支出を同期できませんでした。");
    } finally {
      syncingExpenses.current = false;
    }
  };

  useEffect(() => {
    if (authenticatedUser) void loadPairState();
  }, [authenticatedUser]);

  useEffect(() => {
    if (!pairState?.pair) return;
    const pending = loadState().expenses.filter((expense) => expense.pending);
    if (pending.length > 0 && navigator.onLine) {
      void synchronizeExpenses(pending);
    } else {
      void refreshSharedLedger().catch((error) => setMessage(error instanceof Error ? error.message : "共有データを取得できませんでした。"));
    }

    const retry = () => {
      const queued = loadState().expenses.filter((expense) => expense.pending);
      void synchronizeExpenses(queued);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [pairState?.pair?.id]);

  useEffect(() => {
    if (!invitationToken) return;
    fetch(`/api/invitations/${encodeURIComponent(invitationToken)}`)
      .then(async (response) => {
        const data = await response.json<{ invitation?: InvitationDetails; error?: string }>();
        if (!response.ok || !data.invitation) throw new Error(data.error ?? "招待を確認できませんでした。");
        setInvitationDetails(data.invitation);
      })
      .catch((error) => setInvitationError(error instanceof Error ? error.message : "招待を確認できませんでした。"));
  }, [invitationToken]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 2200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const amountFor = (value: string) => (value === "" ? 0 : Number(value));
  const toggleMode = () => {
    if (mode === "individual") {
      const combined = amountFor(leftAmount) + amountFor(rightAmount);
      setLeftAmount(combined === 0 ? "" : String(combined));
      setRightAmount("");
      setMode("split");
      return;
    }
    setMode("individual");
  };

  const addExpense = (event: React.FormEvent) => {
    event.preventDefault();
    const savedExpense = editingId ? appState.expenses.find((item) => item.id === editingId) : undefined;
    const expense: Expense = {
      id: editingId ?? crypto.randomUUID(),
      payer,
      mode,
      leftAmount: amountFor(leftAmount),
      rightAmount: amountFor(rightAmount),
      memo: mode === "split" ? memo.trim() : "",
      leftMemo: mode === "individual" ? leftMemo.trim() : undefined,
      rightMemo: mode === "individual" ? rightMemo.trim() : undefined,
      version: savedExpense?.version,
      pending: pairState?.pair ? savedExpense?.pending ?? !editingId : undefined,
    };

    if (!isValidExpense(expense)) {
      setMessage("金額は1円以上の整数で入力してください。");
      return;
    }

    setAppState((current) => {
      const added = editingId
        ? current.expenses.map((saved) => saved.id === editingId ? expense : saved)
        : [...current.expenses, expense];
      if (pairState?.pair) return { ...current, expenses: added };
      const trimmed = moveOldestToBase(current.base, added);
      return { ...current, ...trimmed };
    });
    setLeftAmount("");
    setRightAmount("");
    setMemo("");
    setLeftMemo("");
    setRightMemo("");
    setEditingId(null);
    if (pairState?.pair) {
      if (savedExpense?.version && !savedExpense.pending) {
        void fetch(`/api/expenses/${encodeURIComponent(expense.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...expense, pending: undefined }),
        }).then(async (response) => {
          const data = await response.json<SharedLedger & { error?: string }>();
          if (!response.ok) throw new Error(data.error ?? "記録を更新できませんでした。");
          applySharedLedger(data);
          setMessage("記録を更新しました。");
        }).catch((error) => {
          void refreshSharedLedger().catch(() => undefined);
          setMessage(error instanceof Error ? error.message : "記録を更新できませんでした。");
        });
      } else {
        setMessage(navigator.onLine ? "支払いを記録しました。" : "同期待ちとして保存しました。");
        void synchronizeExpenses([expense]);
      }
    } else {
      setMessage(editingId ? "記録を更新しました。" : "支払いを記録しました。");
    }
  };

  const editExpense = (expense: Expense) => {
    if (pairState?.pair && !expense.pending && !navigator.onLine) {
      setMessage("オフラインでは同期済みの記録を編集できません。");
      return;
    }
    setEditingId(expense.id);
    setPayer(expense.payer);
    setMode(expense.mode);
    setLeftAmount(String(expense.leftAmount || ""));
    setRightAmount(String(expense.rightAmount || ""));
    setMemo(expense.memo);
    setLeftMemo(expense.leftMemo ?? (expense.mode === "individual" && expense.payer === "left" ? expense.memo : ""));
    setRightMemo(expense.rightMemo ?? (expense.mode === "individual" && expense.payer === "right" ? expense.memo : ""));
    setRevealedExpenseId(null);
    setMessage("記録を編集中です。");
  };

  const deleteExpense = (id: string) => {
    const expense = appState.expenses.find((item) => item.id === id);
    if (pairState?.pair && expense && !expense.pending) {
      if (!navigator.onLine) {
        setMessage("オフラインでは同期済みの記録を削除できません。");
        return;
      }
      void fetch(`/api/expenses/${encodeURIComponent(id)}?version=${expense.version ?? 0}`, { method: "DELETE" })
        .then(async (response) => {
          const data = await response.json<SharedLedger & { error?: string }>();
          if (!response.ok) throw new Error(data.error ?? "記録を削除できませんでした。");
          applySharedLedger(data);
          setMessage("記録を削除しました。");
        })
        .catch((error) => setMessage(error instanceof Error ? error.message : "記録を削除できませんでした。"));
      setRevealedExpenseId(null);
      return;
    }
    setAppState((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => expense.id !== id),
    }));
    setMessage("記録を削除しました。");
    if (editingId === id) setEditingId(null);
    setRevealedExpenseId(null);
  };

  const submitInvitation = async (email: string) => {
    const response = await fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json<{ error?: string }>();
    if (!response.ok) {
      setMessage(data.error ?? "招待メールを送信できませんでした。");
      return;
    }
    setMessage("招待メールを送信しました。");
    setInviteEmail("");
    await loadPairState();
  };

  const removeInvitation = async (invitationId: string) => {
    const response = await fetch(`/api/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json<{ error?: string }>();
      setMessage(data.error ?? "招待を取り消せませんでした。");
      return;
    }
    setMessage("招待を取り消しました。");
    await loadPairState();
  };

  const joinPair = async () => {
    if (!invitationToken) return;
    const response = await fetch(`/api/invitations/${encodeURIComponent(invitationToken)}`, { method: "POST" });
    const data = await response.json<{ pair?: { id: string }; error?: string }>();
    if (!response.ok) {
      setInvitationError(data.error ?? "招待を受諾できませんでした。");
      return;
    }
    location.assign("/");
  };

  const displayedParticipants: Participant[] = appState.leftOnLeft ? ["left", "right"] : ["right", "left"];
  const participantNames = appState.names;
  const historyRows = useMemo(() => {
    let previousOddExtra = appState.base.lastOddExtra;
    const rows = appState.expenses.map((expense) => {
      const burden = getBurden(expense, previousOddExtra);
      previousOddExtra = burden.oddExtra;
      return { expense, burden };
    });
    return rows.reverse();
  }, [appState.base.lastOddExtra, appState.expenses]);

  if (invitationToken) {
    const returnTo = encodeURIComponent(`/invitations/${invitationToken}`);
    return (
      <main className="app-shell invitation-page">
        <header className="topbar"><a className="brand" href="/">PayBalance</a></header>
        <section className="invitation-card">
          <h1>ペアへの招待</h1>
          {invitationError ? (
            <p>{invitationError}</p>
          ) : !invitationDetails ? (
            <p>招待を確認しています…</p>
          ) : (
            <>
              <p><strong>{invitationDetails.inviterName}</strong> さんから招待されています。</p>
              {!authLoaded ? (
                <p>ログイン状態を確認しています…</p>
              ) : authenticatedUser ? (
                <button className="primary-button" onClick={joinPair} type="button">ペアに参加する</button>
              ) : (
                <a className="settings-login" href={`/api/auth/google?returnTo=${returnTo}`}>Googleでログインして参加</a>
              )}
            </>
          )}
        </section>
      </main>
    );
  }

  if (view === "settings") {
    return (
      <main className="app-shell settings-page">
        <header className="topbar">
          <button className="back-button" onClick={() => setView("home")} type="button">← 戻る</button>
          <span className="brand">設定</span>
        </header>
        <section className="settings-section">
          <h1>表示名</h1>
          {!authenticatedUser && <a className="settings-login" href="/api/auth/google">Googleでログイン</a>}
          {(["left", "right"] as const).map((participant) => (
            <label className="settings-field" key={participant}>
              <span>{participant === "left" ? "左側の人" : "右側の人"}</span>
              <input
                maxLength={24}
                onChange={(event) => setAppState((current) => ({
                  ...current,
                  names: { ...current.names, [participant]: event.target.value },
                }))}
                value={participantNames[participant]}
              />
            </label>
          ))}
        </section>
        <section className="settings-section">
          <h1>表示順</h1>
          <button className="outline-button" onClick={() => setAppState((current) => ({ ...current, leftOnLeft: !current.leftOnLeft }))} type="button">
            {appState.leftOnLeft ? `${participantNames.left} と ${participantNames.right} を入れ替える` : `${participantNames.right} と ${participantNames.left} を入れ替える`}
          </button>
        </section>
        {authenticatedUser && (
          <section className="settings-section">
            <h1>ペア</h1>
            {!pairState ? (
              <p>ペア情報を確認しています…</p>
            ) : pairState.pair ? (
              <p>{pairState.pair.left.displayName} と {pairState.pair.right.displayName} のペアです。</p>
            ) : pairState.invitation ? (
              <div className="pending-invitation">
                <p><strong>{pairState.invitation.invitedEmail}</strong> の受諾を待っています。</p>
                <div className="settings-actions">
                  <button className="outline-button" onClick={() => void submitInvitation(pairState.invitation!.invitedEmail)} type="button">招待を再送</button>
                  <button className="danger-button" onClick={() => void removeInvitation(pairState.invitation!.id)} type="button">招待を取り消す</button>
                </div>
              </div>
            ) : (
              <form className="invitation-form" onSubmit={(event) => { event.preventDefault(); void submitInvitation(inviteEmail); }}>
                <label className="settings-field">
                  <span>相手のメールアドレス</span>
                  <input
                    inputMode="email"
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="friend@example.com"
                    required
                    type="email"
                    value={inviteEmail}
                  />
                </label>
                <button className="primary-button" type="submit">招待メールを送る</button>
              </form>
            )}
          </section>
        )}
        <section className="settings-section destructive-section">
          <h1>精算・ペア</h1>
          <p>精算リセット、ペア解消、アカウント削除は、相手の承認が必要です。</p>
          <button className="outline-button" type="button">精算リセットを申請</button>
          <button className="danger-button" type="button">ペア解消を申請</button>
        </section>
        {message && <p className="form-message" role="status">{message}</p>}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PayBalance ホーム">PayBalance</a>
        <button className="settings-button" onClick={() => setView("settings")} type="button" aria-label="設定を開く">•••</button>
      </header>

      <section className="balance-panel" aria-label="現在の支払いバランス">
        <div className="balance-copy">
          <p>次に払う人</p>
          <strong>{participantNames[ledger.nextPayer]}</strong>
        </div>
        <div className="difference-copy">
          <p>差分</p>
          <strong><span>{ledger.difference.toLocaleString("ja-JP")}</span><small>円</small></strong>
        </div>
      </section>

      <form className="entry-form" onSubmit={addExpense}>
        <div className="form-controls">
          <button
            aria-label={`負担方式：${mode === "individual" ? "個別" : "一括"}`}
            aria-pressed={mode === "split"}
            className={`mode-switch ${mode === "split" ? "is-split" : "is-individual"}`}
            onClick={toggleMode}
            type="button"
          >
            <span className="mode-individual">個別</span>
            <span className="mode-split">一括</span>
            <span className="mode-thumb" aria-hidden="true"></span>
          </button>
          <div className="section-heading">
            <span>払う人</span>
            <div className="segmented" aria-label="支払う人">
              {displayedParticipants.map((participant) => (
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
        </div>

        <div className="entry-details">
          {mode === "individual" ? (
            <>
            <div className="amount-grid">
              {displayedParticipants.map((participant) => (
                <label className="amount-field" key={participant}>
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
            <div className="individual-memos">
              {displayedParticipants.map((participant) => (
                <label className="individual-memo" key={participant}>
                  <input
                    aria-label={`${participantNames[participant]}のメモ`}
                    maxLength={48}
                    onChange={(event) => participant === "left" ? setLeftMemo(event.target.value) : setRightMemo(event.target.value)}
                    placeholder="メモ（任意）"
                    value={participant === "left" ? leftMemo : rightMemo}
                  />
                </label>
              ))}
            </div>
            </>
          ) : (
            <>
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
              <label className="memo-field">
                <input aria-label="メモ（任意）" maxLength={48} onChange={(event) => setMemo(event.target.value)} placeholder="メモ（任意）" value={memo} />
              </label>
            </>
          )}
        </div>
        <button className="save-button" type="submit">記録</button>
        {message && <p className="form-message" role="status">{message}</p>}
      </form>

      <section className="history" aria-label="最近の支払い">
        <div className="history-title"><h1>最近の支払い</h1><span>最新10件</span></div>
        {appState.expenses.length === 0 ? (
          <p className="empty-state">まだ記録がありません。</p>
        ) : (
          <ul className="history-grid">
            {historyRows.map(({ expense, burden }) => (
              <li className={`history-row ${expense.pending ? "is-pending" : ""}`} key={expense.id}>
                <button className="swipe-delete" onClick={() => deleteExpense(expense.id)} type="button">削除</button>
                <div
                  className={`history-row-content ${revealedExpenseId === expense.id ? "is-revealed" : ""}`}
                  onClick={() => {
                    if (suppressedClickId.current === expense.id) {
                      suppressedClickId.current = null;
                      return;
                    }
                    if (revealedExpenseId === expense.id) {
                      setRevealedExpenseId(null);
                      return;
                    }
                    editExpense(expense);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      editExpense(expense);
                    }
                  }}
                  onTouchEnd={(event) => {
                    const start = touchStart.current;
                    if (!start || start.id !== expense.id) return;
                    const distance = event.changedTouches[0].clientX - start.x;
                    if (distance < -36) setRevealedExpenseId(expense.id);
                    if (distance > 36) setRevealedExpenseId(null);
                    if (Math.abs(distance) > 12) suppressedClickId.current = expense.id;
                    touchStart.current = null;
                  }}
                  onTouchStart={(event) => { touchStart.current = { id: expense.id, x: event.touches[0].clientX }; }}
                  role="button"
                  tabIndex={0}
                >
                  {(["left", "right"] as const).map((participant) => {
                    const cellMemo = getExpenseMemo(expense, participant);
                    return (
                      <div className={`history-cell person-${participant}`} key={participant}>
                        <span>{cellMemo}</span>
                        <strong>{formatYen(burden[participant])}</strong>
                      </div>
                    );
                  })}
                </div>
                {expense.pending && <span className="pending-label">同期待ち</span>}
              </li>
            ))}
            {Array.from({ length: Math.max(0, 10 - historyRows.length) }, (_, index) => (
              <li className="history-row placeholder-row" key={`placeholder-${index}`} aria-hidden="true">
                <div className="history-cell person-left"><span></span><strong></strong></div>
                <div className="history-cell person-right"><span></span><strong></strong></div>
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
