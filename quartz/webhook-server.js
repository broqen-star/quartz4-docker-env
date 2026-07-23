import http from "http";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";

const PORT = 4000;
const QUARTZ_DIR = "/quartz";
const CONTENT_DIR = "/quartz/content";
const BUILD_DIR = "/quartz/out";      // ビルド出力先(コンテナ内の通常ディレクトリ)
const PUBLIC_DIR = "/quartz/public";  // nginxが配信(バインドマウント)
const CONTENT_REPO = process.env.CONTENT_REPO || "";

// 同時ビルドを防ぐ簡易ロック(ビルド中に来たら1回だけ後追いする)
let building = false;
let queued = false;

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      err ? reject(err) : resolve();
    });
  });
}

// contentが未cloneで CONTENT_REPO 指定があれば自動clone
async function ensureContent() {
  if (fs.existsSync(`${CONTENT_DIR}/.git`)) return true;
  if (!CONTENT_REPO) {
    console.log("content is not a git repo yet (clone it into ./content).");
    return false;
  }
  console.log(`Cloning content from ${CONTENT_REPO} ...`);
  await run("git", ["clone", CONTENT_REPO, CONTENT_DIR]);
  return true;
}

// BUILD_DIR の中身を PUBLIC_DIR へ反映する。
// PUBLIC_DIR 自体は削除しない(バインドマウントなので削除するとEBUSYになる)。
async function publish() {
  await fs.promises.mkdir(PUBLIC_DIR, { recursive: true });
  // 中身だけを削除
  for (const entry of await fs.promises.readdir(PUBLIC_DIR)) {
    await fs.promises.rm(path.join(PUBLIC_DIR, entry), { recursive: true, force: true });
  }
  // ビルド結果をコピー
  await fs.promises.cp(BUILD_DIR, PUBLIC_DIR, { recursive: true });
}

async function rebuild() {
  if (building) { queued = true; return; }
  building = true;
  try {
    const hasRepo = await ensureContent();
    if (hasRepo) {
      console.log("Pulling latest content...");
      await run("git", ["-C", CONTENT_DIR, "pull", "--ff-only"]);
    }
    // publicはバインドマウントのため、Quartzがビルド前に出力先を
    // ディレクトリごと削除しようとすると EBUSY になる。
    // → コンテナ内の通常ディレクトリ(BUILD_DIR)へ出力し、中身だけを同期する。
    console.log("Building site...");
    await run("npx", ["quartz", "build", "-o", BUILD_DIR], QUARTZ_DIR);

    console.log("Publishing to public/...");
    await publish();
    console.log("Build complete.");
  } catch (e) {
    console.error("Rebuild failed:", e.message);
  } finally {
    building = false;
    if (queued) { queued = false; rebuild(); }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK\n");
    console.log("Webhook received.");
    rebuild();
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found\n");
  }
});

server.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  rebuild(); // 起動時に一度ビルドしておく
});
