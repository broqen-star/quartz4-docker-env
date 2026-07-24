FROM node:22-slim

# git: Quartzの取得とcontentのpullに使用 / ca-certificates: https用
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# bind-mountしたリポジトリで "dubious ownership" を出さないため
RUN git config --global --add safe.directory '*'

WORKDIR /quartz

# Quartz本体をイメージ内に取得(リポジトリには含めない = シンプル化の肝)
ARG QUARTZ_VERSION=v4.5.2
RUN git clone --depth 1 -b ${QUARTZ_VERSION} https://github.com/jackyzha0/quartz.git .

# 日本語(CJK)全文検索の修正パッチを適用
# v4標準の検索は空白でしか分割せず日本語が1トークンになってしまうため、
# CJK文字を1文字ずつトークン化する encoder に差し替える(v5相当の対応)
COPY search-cjk.patch ./search-cjk.patch
RUN git apply search-cjk.patch

RUN npm ci

# 自分の設定とwebhookサーバーだけを上書きで持ち込む
# (runtimeでもbind-mountされるので、編集→再ビルドで反映可能)
COPY quartz.config.ts ./quartz.config.ts
COPY quartz.layout.ts ./quartz.layout.ts
# カスタムCSS: styles/ をまるごと quartz/styles/custom/ として持ち込み、
# 本体のcustom.scssはそれを読み込むだけのローダーにする
COPY styles/ ./quartz/styles/custom/
RUN printf '@use "./base.scss";\n@use "./custom/index.scss";\n' > quartz/styles/custom.scss
COPY webhook-server.js ./webhook-server.js

EXPOSE 4000
CMD ["node", "webhook-server.js"]
