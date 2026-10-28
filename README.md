# quartz4-docker-env

Obsidianで作ったコンテンツを、スタンドアロン環境のWebサーバーに公開する構成です。

- **Gitea (v28系)** … Obsidian vault(Markdown)を管理するGitサーバー
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

> **Gitea v28 の webhook 宛先制限について**
>
> v28 から webhook の送信先は egress policy で制限され、`quartz` のような
> プライベートIP宛ては **IP/CIDR で明示的に許可**する必要があります
> (ホスト名や `*` では許可されません)。
> 本構成では Docker ネットワークのサブネットを `172.30.0.0/24` に固定し、
> その範囲を `GITEA__security__ALLOWED_HOST_LIST` で許可しています。
> 詳しくは「Gitea v28 対応について」を参照してください。

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
- Giteaのバージョン: `docker-compose.yml` の `image: gitea/gitea:28` はメジャーバージョン固定。
  パッチ更新は `docker compose pull gitea && docker compose up -d gitea` で取り込めます。
  次のメジャー(29など)へ上げるときはリリースノートの Breaking changes を確認してから変更してください
  (Giteaはダウングレード非対応です)
- Dockerネットワークのサブネット: `docker-compose.yml` 末尾の `networks` で `172.30.0.0/24` に固定。
  サーバー上の他のネットワークと重なる場合は、ここと `GITEA__security__ALLOWED_HOST_LIST` を同じ値に変更し、
  `docker compose down && docker compose up -d` で作り直してください
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

## Gitea v28 対応について

Gitea v28 で webhook の送信先制限の仕組みが変わりました。本構成は以下の設定で対応しています。

```yaml
  gitea:
    image: gitea/gitea:28
    environment:
      # ...
      - GITEA__security__ALLOWED_HOST_LIST=172.30.0.0/24

# ...

networks:
  default:
    ipam:
      config:
        - subnet: 172.30.0.0/24
```

- `[webhook] ALLOWED_HOST_LIST` は廃止され、`[security] ALLOWED_HOST_LIST` に移行
- ワイルドカード `*` は使用不可
- プライベートIP宛ては、ホスト名ではなく IP/CIDR の指定が必須
- コンテナのIPは作り直すたびに変わり得るため、サブネットを固定して範囲で許可しています

### v27以前の環境からアップグレードする場合

旧構成では `GITEA__webhook__ALLOWED_HOST_LIST=*` を設定していました。
Giteaの公式イメージは起動時に `GITEA__` 環境変数を `app.ini` へ**追加・上書きしますが、削除はしません**。
そのため docker-compose.yml から環境変数を消しても `app.ini` に旧設定が残り、
**新しい `[security]` の設定より優先されて webhook が拒否され続けます**。

以下の手順で旧設定を削除してください。

1. docker-compose.yml を上記の内容に更新する(`GITEA__webhook__ALLOWED_HOST_LIST` は削除)
2. ネットワークごと作り直す(データはホスト側に残ります。`-v` は付けないこと)

   ```bash
   docker compose down
   docker compose up -d
   ```

3. Giteaを停止し、`app.ini` をバックアップしてから `[webhook]` の `ALLOWED_HOST_LIST = *` を削除する

   ```bash
   docker compose stop gitea
   sudo cp -p ./gitea/gitea/conf/app.ini ./gitea/gitea/conf/app.ini.bak
   sudo sed -i '/^\[webhook\]/,/^\[/{/^ALLOWED_HOST_LIST *= *\*$/d}' ./gitea/gitea/conf/app.ini
   docker compose start gitea
   ```

4. Giteaのwebhook設定画面で「テスト配信」を行い、`docker compose logs quartz` に
   `Webhook received.` → `Build complete.` が出れば完了

新規構築の場合は旧設定が `app.ini` に書き込まれないため、この手順は不要です。

### トラブルシューティング

- `denied by egress policy: quartz(172.x.x.x) needs an explicit IP allow entry (non-public address)`
  - `ALLOWED_HOST_LIST` にquartzのIPを含むCIDRが入っているか確認
  - ログに `Deprecation: config option [webhook].ALLOWED_HOST_LIST present` が出ていれば、`app.ini` に旧設定が残っている(上記手順3)
- `lookup db on 127.0.0.11:53: server misbehaving` でGiteaが起動しない
  - ネットワーク変更後に古いコンテナが残っている。`docker compose down && docker compose up -d` で作り直す
- 起動直後のquartzログに `Failed to connect to gitea port 3000`
  - Giteaの起動完了前に初回ビルドが走っただけ。webhookが届けば再ビルドされるので問題なし
- 設定の反映方法
  - environment の変更は `docker compose up -d`(`restart` では反映されない)
  - 現在の設定値は `docker compose exec gitea grep -n -A5 '^\[security\]' /data/gitea/conf/app.ini` で確認できる
  