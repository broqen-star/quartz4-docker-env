# quartz4-docker-env

Obsidianで作ったコンテンツを、スタンドアロン環境のWebサーバーに公開する構成です。

- **Gitea** … Obsidian vault(Markdown)を管理するGitサーバー
- **PostgreSQL** … Gitea用のDB
- **Quartz** … MarkdownをHTMLへビルド。webhookの受け口も兼ねる
- **Nginx** … 生成されたサイトを配信
- Giteaにpushされると **webhook → Quartzビルド** が自動で走ります

## 構成

```
.
├── docker-compose.yml
├── nginx.conf
├── README.md
└── quartz/
    ├── Dockerfile          # Quartz本体はビルド時に取得(リポジトリには入れない)
    ├── quartz.config.ts    # 自分の設定
    ├── quartz.layout.ts    # レイアウト
    ├── search-cjk.patch    # 日本語(CJK)全文検索の修正パッチ
    └── webhook-server.js   # pull → build するだけ
```

Quartz本体・node_modules・ビルド成果物はリポジトリに含めません。
`gitea/` `postgres/` `content/` `public/` は起動後に自動生成されます。

## セットアップ

### 1. 起動

```bash
docker compose up -d --build
```

### 2. Giteaを初期設定

ブラウザで `http://<サーバー>:3000` を開き、初回セットアップ → 管理ユーザー作成。
vault管理用のリポジトリ（例: `vault`）を作成します。

### 3. Obsidian vault を push

Obsidian vaultのディレクトリで、作成したGiteaリポジトリへpushします。

```bash
cd /path/to/your/obsidian-vault
git init
git add .
git commit -m "init"
git remote add origin http://<サーバー>:3000/<user>/vault.git
git push -u origin main
```

### 4. content を用意する（どちらか）

**A. 自動clone（おすすめ）**
`.env` を作成して再起動すると、Quartzが初回に自動でcloneします。

```bash
echo 'CONTENT_REPO=http://gitea:3000/<user>/vault.git' > .env
docker compose up -d
```

**B. 手動clone**

```bash
git clone http://<サーバー>:3000/<user>/vault.git content
```

### 5. Giteaにwebhookを追加

リポジトリ → Settings → Webhooks → Gitea を追加。

- **Target URL**: `http://quartz:4000/webhook`  （コンテナ間通信）
- **Method**: POST
- **Content Type**: application/json
- **Trigger**: Push Events

以降、pushするたびに自動でビルドされます。

### 6. 閲覧

`http://<サーバー>` にアクセス。

## 公開範囲について

vaultは**まるごと公開**されます（`content` にcloneしたものがそのままサイトになります）。
除外したいものがある場合:

- `.obsidian` は既定で除外済み（`quartz.config.ts` の `ignorePatterns`）
- 個別に隠したいノートは frontmatter に `draft: true` を付ける

## よく使う操作

```bash
# 手動でビルドを走らせる（webhookを直接叩く）
curl -X POST http://<サーバー>:4000/webhook

# ログ確認
docker compose logs -f quartz

# 設定(quartz.config.ts / layout)変更を反映
#  → ファイルはbind-mount済みなので、ビルドを再実行すればOK
curl -X POST http://<サーバー>:4000/webhook
```

## カスタマイズ

- 公開ドメイン: `quartz/quartz.config.ts` の `baseUrl` を実際の値に変更
- Quartzのバージョン: `quartz/Dockerfile` の `ARG QUARTZ_VERSION` を変更して `docker compose build`
- DB認証情報: `docker compose.yml` の `gitea` / `db` 環境変数（本番では変更推奨）

## 日本語(全文検索)対応について

Quartz v4 標準の検索は、テキストを**空白でしか分割しません**。日本語は単語間に
空白がないため、文がまるごと1トークンになり、文中の語句(例:「検索」)で
ヒットしない問題があります。

本構成では `quartz/search-cjk.patch` をビルド時に適用し、CJK(日本語・中国語・韓国語)文字を1文字ずつトークン化する encoder に差し替えています。
これにより、日本語の文中の語句でも全文検索がヒットするようになります。

- 適用はイメージビルド時に自動(`Dockerfile` 内の `git apply search-cjk.patch`)
- 不要な場合は `Dockerfile` の該当行を削除して `docker compose build`

## ビルド出力の扱い(EBUSY対策)

Quartzはビルド開始時に出力ディレクトリを**ディレクトリごと削除**します。
`public` はバインドマウント(`./public:/quartz/public`)なので、そのまま出力先に
指定すると `EBUSY: resource busy or locked, rmdir 'public'` で失敗します。

そのため本構成では、

1. コンテナ内の通常ディレクトリ `/quartz/out` へビルド(`npx quartz build -o /quartz/out`)
2. その**中身だけ**を `/quartz/public` へ同期(マウントポイント自体は消さない)

という手順にしています(`webhook-server.js` の `publish()`)。
古くなったファイルは同期時に削除されるので、公開内容は毎回ビルド結果と一致します。
