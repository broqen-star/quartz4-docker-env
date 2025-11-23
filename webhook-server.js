import http from 'http';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname 相当を ESM で再現
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function handleRequest(req, res) {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      console.log('Webhook received:', body);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK\n');

      const vaultDir = '/quartz/vault';       // ← git pull するディレクトリ
      const contentDir = '/quartz/content';   // ← コピー先
      const quartzDir = __dirname;

      console.log('Current cwd before npx quartz build:', process.cwd());
      console.log('vaultDir:', vaultDir);

      // 1. vaultディレクトリで git pull
      exec(
        'git config --global --add safe.directory /quartz/vault && git pull origin main',
        { cwd: vaultDir, shell: true },
        (err, stdout, stderr) => {
          if (err) {
            console.error('Git pull failed:', err);
            return;
          }
          console.log('Git pull output:\n', stdout);
          if (stderr) console.error('Git pull error output:\n', stderr);

          // 2. pull後に /quartz/vault/deploy を /quartz/content にコピー
          exec(
            'rm -rf /quartz/content/* && cp -r /quartz/vault/deploy/* /quartz/content/',
            (errCopy, stdoutCopy, stderrCopy) => {
              if (errCopy) {
                console.error('Copy to content failed:', errCopy);
                return;
              }
              console.log('Copied /quartz/vault/deploy to /quartz/content');
              if (stdoutCopy) console.log(stdoutCopy);
              if (stderrCopy) console.error(stderrCopy);

              // 3. quartzディレクトリでビルド
              console.log('Current cwd before npx quartz build:', process.cwd());
              exec('npx quartz build', { cwd: quartzDir }, (err2, stdout2, stderr2) => {
                if (err2) {
                  console.error('Build failed:', err2);
                  return;
                }

                // Quartz ビルドが成功したら public にコピー
                exec(
                  'rm -rf /deploy/public/* && cp -r /quartz/public/* /deploy/public/',
                  (err3, stdout3, stderr3) => {
                    if (err3) {
                      console.error('Copy failed:', err3);
                      return;
                    }
                    console.log('Quartz build copied to /deploy/public');
                    if (stdout3) console.log(stdout3);
                    if (stderr3) console.error(stderr3);
                  }
                );

                console.log('Build output:\n', stdout2);
                if (stderr2) console.error('Build error output:\n', stderr2);
              });
            }
          );
        }
      );
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
}

const PORT = 4000;
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});

