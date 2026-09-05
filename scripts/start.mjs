#!/usr/bin/env node
/**
 * Starts the local web application, opening the browser once it is listening.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { PATHS } from '../engine/io/paths.mjs';

const port = process.env.PORT || '5178';
const url = `http://localhost:${port}`;

const child = spawn(process.execPath, [path.join(PATHS.server, 'index.js')], {
  stdio: 'inherit',
  env: { ...process.env, PORT: port },
});

if (!process.argv.includes('--no-open')) {
  setTimeout(() => {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); } catch { /* opening a browser is a convenience, not a requirement */ }
  }, 1200);
}

child.on('exit', (code) => process.exit(code ?? 0));
