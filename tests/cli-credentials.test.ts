import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  credentialDirectory,
  deleteCredentials,
  promptSecret,
  readCredentials,
  saveCredentials,
} from '../cli/credentials.mjs';

describe('CLI Credentials Storage', () => {
  let tempBase: string;
  let testEnv: NodeJS.ProcessEnv;
  const sampleToken = 'ctc_live_' + 'a'.repeat(64);
  const sampleData = { url: 'https://example.com/api/mcp', token: sampleToken };

  beforeEach(async () => {
    tempBase = await mkdtemp(join(tmpdir(), 'miler-cred-test-'));
    testEnv = { ...process.env, XDG_CONFIG_HOME: tempBase };
  });

  afterEach(async () => {
    await rm(tempBase, { recursive: true, force: true });
  });

  it('determines the credential directory using XDG_CONFIG_HOME or fallback', () => {
    expect(credentialDirectory(testEnv)).toBe(join(tempBase, 'miler'));
    expect(credentialDirectory(process.env)).toContain('miler');
  });

  it('returns null when credentials file does not exist', async () => {
    const creds = await readCredentials(testEnv);
    expect(creds).toBeNull();
  });

  it('saves and reads credentials with verified format', async () => {
    await saveCredentials(sampleData, testEnv);
    const read = await readCredentials(testEnv);
    expect(read).toEqual(sampleData);
  });

  it('deletes stored credentials idempotently', async () => {
    await saveCredentials(sampleData, testEnv);
    expect(await readCredentials(testEnv)).not.toBeNull();
    await deleteCredentials(testEnv);
    expect(await readCredentials(testEnv)).toBeNull();
    // Subsequent delete does not throw
    await expect(deleteCredentials(testEnv)).resolves.not.toThrow();
  });

  it('rejects credentials file with invalid token format', async () => {
    const credDir = credentialDirectory(testEnv);
    await saveCredentials({ url: 'https://example.com', token: 'invalid_token' }, testEnv).catch(() => {});
    // Write corrupted JSON directly
    const filePath = join(credDir, 'credentials.json');
    await writeFile(filePath, JSON.stringify({ url: 'https://example.com', token: 'bad-token' }));
    await expect(readCredentials(testEnv)).rejects.toThrow('Invalid CLI credentials file');
  });

  it('rejects non-TTY stream in promptSecret', async () => {
    const stream = new PassThrough();
    // @ts-expect-error test non-tty
    stream.isTTY = false;
    await expect(promptSecret(stream as unknown as Parameters<typeof promptSecret>[0], stream as unknown as Parameters<typeof promptSecret>[1])).rejects.toThrow('interactive terminal');
  });
});
