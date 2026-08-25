const { spawnSync } = require('child_process');

function runPowershell(script, env) {
  return spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    }
  );
}

function copyLockedFile(src, dst) {
  const script =
    "$ErrorActionPreference='Stop';" +
    '$in=[System.IO.File]::Open($env:SC_COPY_SRC,' +
    '[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,' +
    "[System.IO.FileShare]'ReadWrite,Delete');" +
    'try{$out=[System.IO.File]::Create($env:SC_COPY_DST);' +
    'try{$in.CopyTo($out)}finally{$out.Dispose()}}finally{$in.Dispose()}';

  const result = runPowershell(script, { SC_COPY_SRC: src, SC_COPY_DST: dst });
  if (result.status !== 0) {
    throw new Error('LOCKED');
  }
}

function dpapiUnprotect(buffer) {
  const script =
    'Add-Type -AssemblyName System.Security;' +
    '$in=[Convert]::FromBase64String($env:SC_DPAPI_IN);' +
    "$out=[System.Security.Cryptography.ProtectedData]::Unprotect($in,$null,'CurrentUser');" +
    '[Console]::Out.Write([Convert]::ToBase64String($out))';

  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: { ...process.env, SC_DPAPI_IN: buffer.toString('base64') },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    }
  );

  if (result.status !== 0) {
    throw new Error(`DPAPI unprotect failed: ${(result.stderr || '').trim() || result.status}`);
  }
  return Buffer.from(result.stdout.trim(), 'base64');
}

module.exports = { dpapiUnprotect, copyLockedFile };
