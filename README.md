## 概要
Obsidianで作ったコンテンツをスタンドアロン環境のwebサーバーに公開する環境。

## 初期設定
```
https://github.com/broqen-star/quartz4-docker-env.git
cd obsidian_quartz
docker compose up -d
```

Web GUI でセットアップ
vault管理用リポジトリ作成

vault 初回 push

Webhook を追加
```
http://[サーバーIP]:4000/webhook
```

Obsidian Vault ディレクトリで ローカル gitea サーバーに push

push した Obsidian のリポジトリを clone
clone先はvaultフォルダ
```
git clone [vaultリポジトリURL] vault
```

Quartz 環境の npm install
```
docker exec obsidian_quartz-quartz-1 npm install
```

ボリューム反映の為に再起動
```
docker compose restart
```
