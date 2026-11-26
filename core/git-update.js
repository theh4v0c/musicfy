'use strict';
/* Move an installed checkout to the published branch.
 *
 * `git pull --ff-only` was the wrong tool for an installation:
 *   - install.sh clones with --depth 1, so the local history is a graft
 *   - a checkout from before a rewritten history has no common ancestor
 *   - an older installer left a detached HEAD
 * All three make a fast-forward impossible, which is not the owner's problem to solve.
 * Fetch the branch and move the pointer to it, which is what install.sh does.
 *
 * A tracked local edit is the owner's: it stops the update instead of being discarded.
 * Untracked files (a .DS_Store, a note) are left alone.
 */
const { execFile } = require('node:child_process');

function git(appRoot, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', appRoot, ...args], { timeout }, (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout || ''));
      // the reason is on stderr; the message alone is just "Command failed"
      const detail = String(stderr || err.stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' ');
      if (detail && !String(err.message || '').includes(detail)) err.message = `${err.message}: ${detail}`;
      reject(err);
    });
  });
}

async function gitUpdate(appRoot, branch = 'main') {
  const target = branch || 'main';
  let dirty = '';
  try { dirty = String(await git(appRoot, ['status', '--porcelain', '--untracked-files=no'], 10000)).trim(); } catch {}
  if (dirty) {
    const files = dirty.split('\n').slice(0, 5).map((l) => l.trim().split(/\s+/).pop()).join(', ');
    throw new Error(`the app folder has local changes (${files}); commit or discard them, then update again`);
  }
  await git(appRoot, ['fetch', '--depth', '1', '--tags', 'origin', target], 60000);
  // -B is the same from a branch, a detached HEAD, a shallow root or a rewritten history
  await git(appRoot, ['checkout', '-q', '-B', target, 'FETCH_HEAD'], 20000);
  try { await git(appRoot, ['branch', '--set-upstream-to', `origin/${target}`, target], 5000); } catch {}
  const head = (await git(appRoot, ['rev-parse', '--short', 'HEAD'], 5000)).trim();
  return { mode: 'fetch and move the branch', branch: target, head, output: `fetched origin/${target}, now on ${target} at ${head}` };
}

module.exports = { gitUpdate };
