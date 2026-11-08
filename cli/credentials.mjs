import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function credentialDirectory(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'miler');
}

export async function readCredentials(env = process.env) {
  try {
    const file = join(credentialDirectory(env), 'credentials.json');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('CLI credentials file must be a private regular file.');
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (typeof data.url !== 'string' || !/^ctc_live_[0-9a-f]{64}$/.test(data.token)) throw new Error('Invalid CLI credentials file.');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveCredentials(data, env = process.env) {
  const directory = credentialDirectory(env);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('CLI config directory must be a directory, not a symlink.');
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('CLI config directory must be private (mode 700).');
  const file = join(directory, 'credentials.json');
  const temporary = join(directory, `.credentials-${randomBytes(12).toString('hex')}`);
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { await handle.writeFile(JSON.stringify(data)); } finally { await handle.close(); }
    await rename(temporary, file);
    if (process.platform !== 'win32') await chmod(file, 0o600);
  } finally { await rm(temporary, { force: true }); }
}

export async function deleteCredentials(env = process.env) {
  await rm(join(credentialDirectory(env), 'credentials.json'), { force: true });
}

export async function promptSecret(input = process.stdin, output = process.stderr) {
  if (!input.isTTY) throw new Error('Login requires an interactive terminal so the CLI username stays private.');
  output.write('CLI username: ');
  return await new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = input.isRaw;
    const finish = (error) => {
      input.off('data', onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003' || character === '\u0004') return finish(new Error('Login cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && value.length < 256) value += character;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}
