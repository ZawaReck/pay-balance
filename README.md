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
