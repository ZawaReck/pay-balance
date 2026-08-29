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

未ログイン時の画面と支払い計算はブラウザのローカル保存で動作します。Googleログイン、手動共有する招待リンクによるペア招待・受諾、ペア間の支出同期APIを実装済みです。オフラインの新規支出は端末に保留され、通信復帰後に同期されます。

## データベース

共有機能は Cloudflare D1 を使用します。`migrations/` には利用者、セッション、ペア、招待、支出のスキーマを用意しています。D1への変更は、ローカル検証後にマイグレーションとして適用します。

Googleログインには `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` をCloudflareの本番シークレットとして設定します。
