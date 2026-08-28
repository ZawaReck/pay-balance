# PayBalance

二人の支払いを記録し、次に支払う人を分かりやすくする React PWA です。

## 開発

```sh
npm install
npm run dev
```

## 検証

```sh
npm test
npm run lint
npm run build
```

## デプロイ

Cloudflare にログイン済みの環境で次を実行します。

```sh
npm run deploy
```

現時点では、画面と支払い計算をブラウザのローカル保存で動作させています。Googleログイン、招待メール、共有データ同期は後続実装です。

## データベース

共有機能は Cloudflare D1 を前提とし、初期スキーマを `migrations/0001_initial.sql` に用意しています。D1 データベースを作成した後、`wrangler.jsonc` に `DB` バインディングを追加してマイグレーションを適用します。Google OAuth のクライアント情報と招待メールの送信サービスも、本番化時にシークレットとして設定します。
