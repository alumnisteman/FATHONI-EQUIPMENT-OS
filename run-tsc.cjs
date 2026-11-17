const { execSync } = require('child_process');
const fs = require('fs');
let out = '';
try {
  execSync('node node_modules/typescript/bin/tsc --noEmit', { cwd: __dirname, encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
  out += 'Frontend: OK\n';
} catch (e) { out += 'Frontend: ERRORS\n' + (e.stdout || '') + (e.stderr || ''); }
fs.writeFileSync('tsc-output.txt', out);
