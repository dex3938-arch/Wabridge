// Development: API with auto-restart on :8080 + dashboard with hot reload on :5173.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const run = (name, cmd, args) => {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin });
  child.on('exit', (code) => {
    console.log(`[${name}] exited with ${code}`);
    process.exit(code ?? 0);
  });
  return child;
};

const api = run('api', process.execPath, ['--disable-warning=ExperimentalWarning', '--watch-path=server', 'server/index.js']);
const web = run('web', isWin ? 'npx.cmd' : 'npx', ['vite', '--config', 'web/vite.config.js']);
console.log('\nDashboard (hot reload): http://localhost:5173   API: http://localhost:8080\n');
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    api.kill();
    web.kill();
    process.exit(0);
  });
}
