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
import { numericFontSize } from "./domain/formatting";
import { anonymousLedgerStorageKey, ledgerStorageKeyFor } from "./storage/ledger-storage";
import "./styles.css";

type AppState = {
  expenses: Expense[];
  base: LedgerBase;
  names: Record<Participant, string>;
  leftOnLeft: boolean;
};

type CurrentUser = { id: string; displayName: string };
type SignedInUser = CurrentUser & { leftOnLeft: boolean };
type PairState = {
  pair: {
    id: string;
    left: CurrentUser;
    right: CurrentUser;
  } | null;
  invitation: { id: string; invitedEmail: string; expiresAt: string; invitationUrl: string | null } | null;
  leftOnLeft: boolean;
};

type InvitationDetails = { inviterName: string; expiresAt: string };
type DestructiveKind = "settle" | "dissolve_pair" | "delete_account";
type DestructiveRequest = {
  id: string;
  kind: DestructiveKind;
  requestedBy: CurrentUser;
  expiresAt: string;
  isRequester: boolean;
};
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

const emptyState = (): AppState => ({
  ...initialState,
  base: { leftNet: 0, lastOddExtra: null },
  names: { ...initialState.names },
  expenses: [],
});

const loadState = (storageKey: string, fallback: AppState): AppState => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return fallback;
    return { ...fallback, ...JSON.parse(saved) } as AppState;
  } catch {
    return fallback;
  }
};

const formatYen = (amount: number) => `${amount.toLocaleString("ja-JP")}円`;
const destructiveLabels: Record<DestructiveKind, string> = {
  settle: "精算リセット",
  dissolve_pair: "ペア解消",
  delete_account: "アカウント削除",
};
const pendingGoogleLoginKey = "paybalance-pending-google-login";

function App() {
  const [storageScope, setStorageScope] = useState(anonymousLedgerStorageKey);
  const [appState, setAppState] = useState<AppState>(() => loadState(anonymousLedgerStorageKey, initialState));
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
  const [authenticatedUser, setAuthenticatedUser] = useState<SignedInUser | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [authLoaded, setAuthLoaded] = useState(false);
  const [pairState, setPairState] = useState<PairState | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitationDetails, setInvitationDetails] = useState<InvitationDetails | null>(null);
  const [invitationError, setInvitationError] = useState("");
  const [destructiveRequest, setDestructiveRequest] = useState<DestructiveRequest | null>(null);
  const [savingDisplayOrder, setSavingDisplayOrder] = useState(false);
  const invitationToken = location.pathname.match(/^\/invitations\/([^/]+)$/)?.[1] ?? null;

  const ledger = useMemo(
    () => calculateLedger(appState.expenses, appState.base, appState.leftOnLeft ? "right" : "left"),
    [appState],
  );

  useEffect(() => {
    localStorage.setItem(storageScope, JSON.stringify(appState));
  }, [appState, storageScope]);

  useEffect(() => {
    const pendingLogin = sessionStorage.getItem(pendingGoogleLoginKey);
    if (!pendingLogin) return;
    sessionStorage.removeItem(pendingGoogleLoginKey);
    location.replace(pendingLogin);
  }, []);

  useEffect(() => {
    setPayer(ledger.nextPayer);
  }, [ledger.nextPayer]);

  useEffect(() => {
    fetch("/api/me")
      .then((response) => response.ok ? response.json() as Promise<{ user?: SignedInUser }> : null)
      .then((data: { user?: SignedInUser } | null) => {
        setAuthenticatedUser(data?.user ?? null);
        setDisplayNameDraft(data?.user?.displayName ?? "");
      })
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
      const nextStorageScope = ledgerStorageKeyFor(authenticatedUser!.id, state.pair?.id ?? null);
      setStorageScope(nextStorageScope);
      const scopedState = loadState(nextStorageScope, emptyState());
      if (state.pair) {
        setAppState({
          ...scopedState,
          leftOnLeft: state.leftOnLeft,
          names: { left: state.pair!.left.displayName, right: state.pair!.right.displayName },
        });
      } else {
        setAppState({ ...scopedState, leftOnLeft: state.leftOnLeft });
      }
    })
    .catch((error) => setMessage(error instanceof Error ? error.message : "ペア情報を取得できませんでした。"));

  const loadDestructiveRequest = () => fetch("/api/destructive-requests")
    .then(async (response) => {
      if (!response.ok) throw new Error((await response.json<{ error?: string }>()).error ?? "申請情報を取得できませんでした。");
      return response.json<{ request: DestructiveRequest | null }>();
    })
    .then((data) => setDestructiveRequest(data.request))
    .catch(() => setDestructiveRequest(null));

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
    if (!pairState?.pair || syncingExpenses.current || expenses.length === 0) return;
    if (!navigator.onLine) {
      setMessage("オフラインです。通信復帰後に再試行してください。");
      return;
    }
    syncingExpenses.current = true;
    const expenseIds = new Set(expenses.map((expense) => expense.id));
    setAppState((current) => ({
      ...current,
      expenses: current.expenses.map((expense) => expenseIds.has(expense.id)
        ? { ...expense, syncError: false }
        : expense),
    }));
    try {
      for (const expense of expenses) {
        const response = await fetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...expense, pending: undefined, syncError: undefined, version: undefined }),
        });
        if (!response.ok) {
          const data = await response.json<{ error?: string }>();
          throw new Error(data.error ?? "支出を同期できませんでした。");
        }
      }
      await refreshSharedLedger();
      setMessage("同期しました。");
    } catch (error) {
      setAppState((current) => ({
        ...current,
        expenses: current.expenses.map((expense) => expenseIds.has(expense.id) && expense.pending
          ? { ...expense, syncError: true }
          : expense),
      }));
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
    const pending = loadState(storageScope, emptyState()).expenses.filter((expense) => expense.pending);
    if (pending.length > 0 && navigator.onLine) {
      void synchronizeExpenses(pending);
    } else {
      void refreshSharedLedger().catch((error) => setMessage(error instanceof Error ? error.message : "共有データを取得できませんでした。"));
    }

    const retry = () => {
      const queued = loadState(storageScope, emptyState()).expenses.filter((expense) => expense.pending);
      void synchronizeExpenses(queued);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [pairState?.pair?.id, storageScope]);

  useEffect(() => {
    if (pairState?.pair) void loadDestructiveRequest();
    else setDestructiveRequest(null);
  }, [pairState?.pair?.id]);

  useEffect(() => {
    if (!pairState?.pair) return;
    const refreshAfterResume = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void refreshSharedLedger().catch(() => { void loadPairState(); });
      void loadDestructiveRequest();
    };
    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("focus", refreshAfterResume);
    return () => {
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("focus", refreshAfterResume);
    };
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

  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get("auth") !== "success") return;
    setMessage("Googleログインしました。");
    url.searchParams.delete("auth");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

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
      syncError: pairState?.pair ? false : undefined,
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
    const data = await response.json<{ invitation?: PairState["invitation"]; error?: string }>();
    if (!response.ok) {
      setMessage(data.error ?? "招待リンクを作成できませんでした。");
      return;
    }
    setMessage("招待リンクを作成しました。");
    setInviteEmail("");
    await loadPairState();
  };

  const copyInvitation = async (invitationUrl: string) => {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setMessage("招待リンクをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。リンクを長押ししてコピーしてください。");
    }
  };

  const startGoogleLogin = async (returnTo = "/") => {
    const query = returnTo === "/" ? "" : `?${new URLSearchParams({ returnTo })}`;
    const loginPath = `/api/auth/google${query}`;
    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration && navigator.serviceWorker.controller) {
          sessionStorage.setItem(pendingGoogleLoginKey, loginPath);
          await registration.unregister();
          location.reload();
          return;
        }
      } catch {
        sessionStorage.removeItem(pendingGoogleLoginKey);
      }
    }
    location.assign(loginPath);
  };

  const shareInvitation = async (invitationUrl: string) => {
    if (!navigator.share) {
      await copyInvitation(invitationUrl);
      return;
    }
    try {
      await navigator.share({
        title: "PayBalanceへの招待",
        text: "PayBalanceのペア招待です。",
        url: invitationUrl,
      });
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "AbortError") {
        setMessage("共有できませんでした。リンクを長押ししてコピーしてください。");
      }
    }
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

  const saveDisplayName = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: displayNameDraft }),
    });
    const data = await response.json<{ user?: SignedInUser; error?: string }>();
    if (!response.ok || !data.user) {
      setMessage(data.error ?? "表示名を更新できませんでした。");
      return;
    }
    setAuthenticatedUser(data.user);
    setDisplayNameDraft(data.user.displayName);
    setAppState((current) => {
      if (!pairState?.pair) return current;
      const participant = pairState.pair.left.id === data.user!.id ? "left" : "right";
      return { ...current, names: { ...current.names, [participant]: data.user!.displayName } };
    });
    await loadPairState();
    setMessage("表示名を更新しました。");
  };

  const toggleDisplayOrder = async () => {
    const previous = appState.leftOnLeft;
    const next = !previous;
    setAppState((current) => ({ ...current, leftOnLeft: next }));
    if (!authenticatedUser) return;

    setSavingDisplayOrder(true);
    try {
      const response = await fetch("/api/display-order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leftOnLeft: next }),
      });
      const data = await response.json<{ leftOnLeft?: boolean; error?: string }>();
      if (!response.ok || typeof data.leftOnLeft !== "boolean") {
        throw new Error(data.error ?? "表示順を保存できませんでした。");
      }
      setAuthenticatedUser((current) => current ? { ...current, leftOnLeft: data.leftOnLeft! } : null);
      setMessage("表示順を更新しました。");
    } catch (error) {
      setAppState((current) => ({ ...current, leftOnLeft: previous }));
      setMessage(error instanceof Error ? error.message : "表示順を保存できませんでした。");
    } finally {
      setSavingDisplayOrder(false);
    }
  };

  const submitDestructiveRequest = async (kind: DestructiveKind) => {
    const response = await fetch("/api/destructive-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const data = await response.json<{ request?: DestructiveRequest; error?: string }>();
    if (!response.ok || !data.request) {
      setMessage(data.error ?? "申請できませんでした。");
      return;
    }
    setDestructiveRequest(data.request);
    setMessage(`${destructiveLabels[kind]}を申請しました。`);
  };

  const cancelPendingRequest = async () => {
    if (!destructiveRequest) return;
    const response = await fetch(`/api/destructive-requests/${encodeURIComponent(destructiveRequest.id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = await response.json<{ error?: string }>();
      setMessage(data.error ?? "申請を取り消せませんでした。");
      return;
    }
    setDestructiveRequest(null);
    setMessage("申請を取り消しました。");
  };

  const approvePendingRequest = async () => {
    if (!destructiveRequest) return;
    const approvedKind = destructiveRequest.kind;
    const response = await fetch(`/api/destructive-requests/${encodeURIComponent(destructiveRequest.id)}/approve`, {
      method: "POST",
    });
    if (!response.ok) {
      const data = await response.json<{ error?: string }>();
      setMessage(data.error ?? "申請を承認できませんでした。");
      return;
    }
    setDestructiveRequest(null);
    setAppState((current) => ({ ...current, base: { leftNet: 0, lastOddExtra: null }, expenses: [] }));
    await loadPairState();
    setMessage(`${destructiveLabels[approvedKind]}を実行しました。`);
  };

  const deleteUnpairedAccount = async () => {
    if (!window.confirm("アカウントを削除します。この操作は取り消せません。")) return;
    const response = await fetch("/api/me", { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json<{ error?: string }>();
      setMessage(data.error ?? "アカウントを削除できませんでした。");
      return;
    }
    setAuthenticatedUser(null);
    setPairState(null);
    setAppState(emptyState());
    localStorage.removeItem(storageScope);
    setView("home");
    setMessage("アカウントを削除しました。");
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
    const returnTo = `/invitations/${invitationToken}`;
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
                <button className="settings-login" onClick={() => void startGoogleLogin(returnTo)} type="button">Googleでログインして参加</button>
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
          {authenticatedUser ? (
            <form className="display-name-form" onSubmit={(event) => void saveDisplayName(event)}>
              <label className="settings-field">
                <span>自分の表示名</span>
                <input
                  maxLength={24}
                  onChange={(event) => setDisplayNameDraft(event.target.value)}
                  required
                  value={displayNameDraft}
                />
              </label>
              <button className="primary-button" type="submit">更新</button>
            </form>
          ) : (
            <>
              <button className="settings-login" onClick={() => void startGoogleLogin()} type="button">Googleでログイン</button>
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
            </>
          )}
        </section>
        <section className="settings-section">
          <h1>表示順</h1>
          <button className="outline-button" disabled={savingDisplayOrder} onClick={() => void toggleDisplayOrder()} type="button">
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
                {pairState.invitation.invitationUrl ? (
                  <>
                    <input
                      aria-label="招待リンク"
                      className="invitation-link"
                      onFocus={(event) => event.currentTarget.select()}
                      readOnly
                      value={pairState.invitation.invitationUrl}
                    />
                    <div className="settings-actions">
                      <button className="primary-button" onClick={() => void shareInvitation(pairState.invitation!.invitationUrl!)} type="button">リンクを共有</button>
                      <button className="outline-button" onClick={() => void copyInvitation(pairState.invitation!.invitationUrl!)} type="button">コピー</button>
                    </div>
                  </>
                ) : (
                  <p>この招待はリンクを再表示できません。新しいリンクを発行してください。</p>
                )}
                <div className="settings-actions">
                  <button className="outline-button" onClick={() => void submitInvitation(pairState.invitation!.invitedEmail)} type="button">リンクを再発行</button>
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
                <button className="primary-button" type="submit">招待リンクを作る</button>
              </form>
            )}
          </section>
        )}
        {authenticatedUser && pairState?.pair && (
          <section className="settings-section destructive-section">
            <h1>精算・ペア</h1>
            <p>精算リセット、ペア解消、アカウント削除は、相手の承認が必要です。</p>
            {destructiveRequest ? (
              <div className="pending-request">
                <p>
                  {destructiveRequest.isRequester
                    ? `${destructiveLabels[destructiveRequest.kind]}を申請中です。相手の承認を待っています。`
                    : `${destructiveRequest.requestedBy.displayName}さんが${destructiveLabels[destructiveRequest.kind]}を申請しています。`}
                </p>
                {destructiveRequest.isRequester ? (
                  <button className="outline-button" onClick={() => void cancelPendingRequest()} type="button">申請を取り消す</button>
                ) : (
                  <button className="danger-button" onClick={() => void approvePendingRequest()} type="button">承認して実行</button>
                )}
              </div>
            ) : (
              <>
                <button className="outline-button" onClick={() => void submitDestructiveRequest("settle")} type="button">精算リセットを申請</button>
                <button className="danger-button" onClick={() => void submitDestructiveRequest("dissolve_pair")} type="button">ペア解消を申請</button>
                <button className="danger-button" onClick={() => void submitDestructiveRequest("delete_account")} type="button">アカウント削除を申請</button>
              </>
            )}
          </section>
        )}
        {authenticatedUser && pairState && !pairState.pair && (
          <section className="settings-section destructive-section">
            <h1>アカウント</h1>
            <p>ペアに所属していないため、アカウントはすぐに削除されます。</p>
            <button className="danger-button" onClick={() => void deleteUnpairedAccount()} type="button">アカウントを削除</button>
          </section>
        )}
        {message && <p className="form-message" role="status">{message}</p>}
      </main>
    );
  }

    return (
      <main className="app-shell home-page">
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
          <strong><span style={{ fontSize: numericFontSize(ledger.difference, 28, 16) }}>{ledger.difference.toLocaleString("ja-JP")}</span><small>円</small></strong>
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
                      style={{ fontSize: numericFontSize(participant === "left" ? leftAmount : rightAmount, 20, 13) }}
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
                    style={{ fontSize: numericFontSize(leftAmount, 20, 13) }}
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
                  {displayedParticipants.map((participant) => {
                    const cellMemo = getExpenseMemo(expense, participant);
                    return (
                      <div className={`history-cell person-${participant}`} key={participant}>
                        <span>{cellMemo}</span>
                        <strong style={{ fontSize: numericFontSize(burden[participant], 16, 11) }}>{formatYen(burden[participant])}</strong>
                      </div>
                    );
                  })}
                </div>
                {expense.pending && (expense.syncError ? (
                  <button
                    className="pending-label retry-sync"
                    onClick={(event) => { event.stopPropagation(); void synchronizeExpenses([expense]); }}
                    type="button"
                  >再試行</button>
                ) : (
                  <span className="pending-label">同期待ち</span>
                ))}
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
