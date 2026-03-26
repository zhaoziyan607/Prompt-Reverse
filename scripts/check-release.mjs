import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function run(cmd) {
  return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function ok(msg) {
  console.log(`OK  ${msg}`);
}
function warn(msg) {
  console.log(`WARN ${msg}`);
}
function fail(msg) {
  console.error(`FAIL ${msg}`);
}

let hasFail = false;

console.log('Release checklist start...');

// 1) Ensure .env is ignored and not tracked
try {
  const ignored = run('git check-ignore .env');
  if (!ignored) {
    hasFail = true;
    fail('.env is not ignored by git. Add it to .gitignore');
  } else {
    ok('.env is ignored by git');
  }
} catch {
  hasFail = true;
  fail('.env is not ignored by git. Add it to .gitignore');
}

try {
  const tracked = run('git ls-files .env');
  if (tracked) {
    hasFail = true;
    fail('.env is tracked by git. Remove it from index immediately.');
  } else {
    ok('.env is not tracked');
  }
} catch {
  ok('.env is not tracked');
}

// 2) Scan tracked text files for common secret patterns
const trackedFiles = run('git ls-files').split(/\r?\n/).filter(Boolean);
const secretPatterns = [
  { name: 'OpenAI/Sk Key', re: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'Baidu BCE Key', re: /bce-v3\/[A-Za-z0-9\-_/]{24,}/g },
  { name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'Private Key Block', re: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
];
const ignoreExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.pdf', '.lock']);
const findings = [];

for (const rel of trackedFiles) {
  const ext = path.extname(rel).toLowerCase();
  if (ignoreExt.has(ext)) continue;
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  let content = '';
  try {
    content = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  for (const p of secretPatterns) {
    if (p.re.test(content)) {
      findings.push({ file: rel, type: p.name });
    }
    p.re.lastIndex = 0;
  }
}

if (findings.length) {
  hasFail = true;
  fail(`Potential secrets found in tracked files (${findings.length})`);
  for (const item of findings.slice(0, 20)) {
    console.error(`  - ${item.file} (${item.type})`);
  }
} else {
  ok('No obvious secrets in tracked files');
}

// 3) Dependency audit (prod)
try {
  execSync('npm audit --omit=dev', { cwd: root, stdio: 'inherit' });
  ok('npm audit --omit=dev passed');
} catch {
  hasFail = true;
  fail('npm audit --omit=dev failed');
}

// 4) Build check
try {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
  ok('Build succeeded');
} catch {
  hasFail = true;
  fail('Build failed');
}

// 5) Uncommitted changes reminder
try {
  const status = run('git status --short');
  if (status) {
    warn('Working tree has uncommitted changes (this is allowed, but review before push).');
  } else {
    ok('Working tree is clean');
  }
} catch {
  // ignore
}

if (hasFail) {
  console.error('\nRelease checklist failed. Fix above issues before pushing.');
  process.exit(1);
}

console.log('\nRelease checklist passed. Safe to push.');
