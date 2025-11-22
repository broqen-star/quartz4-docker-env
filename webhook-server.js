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

      const obsidianDir = path.join(__dirname, './content');
      const quartzDir = __dirname;

      console.log('Current cwd before npx quartz build:', process.cwd());
      console.log('obsidianDir:', obsidianDir);

      // 1. obsidianディレクトリで git pull
      exec(
        'git config --global --add safe.directory /quartz/content && git pull origin main',
        { cwd: obsidianDir, shell: true },
        (err, stdout, stderr) => {
          if (err) {
            console.error('Git pull failed:', err);
            return;
          }
          console.log('Git pull output:\n', stdout);
          if (stderr) console.error('Git pull error output:\n', stderr);

          // 2. quartzディレクトリでビルド
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
