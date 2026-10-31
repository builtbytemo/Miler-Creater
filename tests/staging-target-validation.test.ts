import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateClient = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { validateStagingEnvironment } from '../scripts/test-reminder-integration';
import { runLiveDatabaseAudit } from '../scripts/test-database-rls';
import { runLiveMcpVerification } from '../scripts/test-mcp-integration';

describe('Staging Target Fail-Closed Validation (Phase 5, Step 5.3 & Phase 7, Step 7.1)', () => {
  const validRef = 'abcdefghijklmnopqrst';
  const validUrl = `https://${validRef}.supabase.co`;
  const validKey = 'real-service-role-key-test-value-12345';

  const validEnv = {
    STAGING_SUPABASE_URL: validUrl,
    STAGING_SERVICE_ROLE_KEY: validKey,
    EXPECTED_STAGING_PROJECT_REF: validRef,
    CONFIRM_DISPOSABLE_DATABASE: 'true',
  };

  it('accepts valid, matching staging credentials and returns verified project ref', () => {
    const config = validateStagingEnvironment(validEnv);
    expect(config.projectRef).toBe(validRef);
    expect(config.stagingUrl).toBe(validUrl);
    expect(config.serviceRoleKey).toBe(validKey);
  });

  describe('CONFIRM_DISPOSABLE_DATABASE strict checking', () => {
    it('fails closed when CONFIRM_DISPOSABLE_DATABASE is missing or false', () => {
      expect(() => validateStagingEnvironment({ ...validEnv, CONFIRM_DISPOSABLE_DATABASE: undefined })).toThrow(
        'Target selection rejected: CONFIRM_DISPOSABLE_DATABASE must be explicitly set to "true"'
      );
      expect(() => validateStagingEnvironment({ ...validEnv, CONFIRM_DISPOSABLE_DATABASE: 'false' })).toThrow(
        'Target selection rejected: CONFIRM_DISPOSABLE_DATABASE must be explicitly set to "true"'
      );
    });

    it('fails closed for non-exact values such as 1, yes, TRUE, or empty string', () => {
      for (const invalidConfirm of ['1', 'yes', 'TRUE', '', 'truee', 'false', '0']) {
        expect(() =>
          validateStagingEnvironment({ ...validEnv, CONFIRM_DISPOSABLE_DATABASE: invalidConfirm })
        ).toThrow('Target selection rejected: CONFIRM_DISPOSABLE_DATABASE must be explicitly set to "true"');
      }
    });
  });

  describe('Missing required environment variables', () => {
    it('fails closed when STAGING_SUPABASE_URL is missing', () => {
      expect(() => validateStagingEnvironment({ ...validEnv, STAGING_SUPABASE_URL: undefined })).toThrow(
        'Target selection rejected: STAGING_SUPABASE_URL is missing.'
      );
      expect(() => validateStagingEnvironment({ ...validEnv, STAGING_SUPABASE_URL: '' })).toThrow(
        'Target selection rejected: STAGING_SUPABASE_URL is missing.'
      );
    });

    it('fails closed when STAGING_SERVICE_ROLE_KEY is missing', () => {
      expect(() => validateStagingEnvironment({ ...validEnv, STAGING_SERVICE_ROLE_KEY: undefined })).toThrow(
        'Target selection rejected: STAGING_SERVICE_ROLE_KEY is missing.'
      );
      expect(() => validateStagingEnvironment({ ...validEnv, STAGING_SERVICE_ROLE_KEY: '' })).toThrow(
        'Target selection rejected: STAGING_SERVICE_ROLE_KEY is missing.'
      );
    });

    it('fails closed when EXPECTED_STAGING_PROJECT_REF is missing', () => {
      expect(() => validateStagingEnvironment({ ...validEnv, EXPECTED_STAGING_PROJECT_REF: undefined })).toThrow(
        'Target selection rejected: EXPECTED_STAGING_PROJECT_REF is missing.'
      );
      expect(() => validateStagingEnvironment({ ...validEnv, EXPECTED_STAGING_PROJECT_REF: '' })).toThrow(
        'Target selection rejected: EXPECTED_STAGING_PROJECT_REF is missing.'
      );
    });
  });

  describe('Template placeholder detection', () => {
    it('fails closed when credentials contain template placeholders', () => {
      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'https://your-project-ref.supabase.co',
        })
      ).toThrow('Target selection rejected: STAGING credentials contain template placeholder values.');

      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SERVICE_ROLE_KEY: 'your-service-role-key',
        })
      ).toThrow('Target selection rejected: STAGING credentials contain template placeholder values.');

      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SERVICE_ROLE_KEY: 'your-staging-service-role-key',
        })
      ).toThrow('Target selection rejected: STAGING credentials contain template placeholder values.');
    });
  });

  describe('URL syntax and hostname validation', () => {
    it('fails closed when URL is malformed or invalid syntax', () => {
      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'not-a-valid-url',
        })
      ).toThrow('Target selection rejected: STAGING_SUPABASE_URL is not a valid URL.');

      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'ftp://abcdefghijklmnopqrst.supabase.co',
        })
      ).toThrow('Target selection rejected: STAGING_SUPABASE_URL must use https protocol.');
    });

    it('fails closed when URL is localhost, 127.0.0.1, or local IP', () => {
      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'https://localhost:54321',
        })
      ).toThrow('Target selection rejected: Localhost and local IP targets are not permitted.');

      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'https://127.0.0.1:54321',
        })
      ).toThrow('Target selection rejected: Localhost and local IP targets are not permitted.');

      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'https://0.0.0.0:54321',
        })
      ).toThrow('Target selection rejected: Localhost and local IP targets are not permitted.');
    });

    it('fails closed when URL protocol is not https', () => {
      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: `http://${validRef}.supabase.co`,
        })
      ).toThrow('Target selection rejected: STAGING_SUPABASE_URL must use https protocol.');
    });

    it('fails closed when hostname is not a standard 20-character Supabase domain', () => {
      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'https://custom-domain.example.com',
        })
      ).toThrow('Target selection rejected: STAGING_SUPABASE_URL hostname must match "<ref>.supabase.co"');

      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'https://shortref.supabase.co', // not 20 characters
        })
      ).toThrow('Target selection rejected: STAGING_SUPABASE_URL hostname must match "<ref>.supabase.co"');

      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'https://toolongprojectreferencename.supabase.co', // >20 characters
        })
      ).toThrow('Target selection rejected: STAGING_SUPABASE_URL hostname must match "<ref>.supabase.co"');

      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          STAGING_SUPABASE_URL: 'https://abcdefghijklmno_rst.supabase.co', // invalid underscore
        })
      ).toThrow('Target selection rejected: STAGING_SUPABASE_URL hostname must match "<ref>.supabase.co"');
    });

    it('fails closed when URL project ref does not match EXPECTED_STAGING_PROJECT_REF', () => {
      expect(() =>
        validateStagingEnvironment({
          ...validEnv,
          EXPECTED_STAGING_PROJECT_REF: 'zyxwvutsrqponmlkjihg', // different ref
        })
      ).toThrow('Target selection rejected: URL project reference');
    });
  });

  describe('Isolation from production and secrets sanitation', () => {
    it('never falls back to NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY', () => {
      const envWithOnlyProd = {
        NEXT_PUBLIC_SUPABASE_URL: validUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'prod-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: validKey,
        CONFIRM_DISPOSABLE_DATABASE: 'true',
      };

      expect(() => validateStagingEnvironment(envWithOnlyProd)).toThrow(
        'Target selection rejected: STAGING_SUPABASE_URL is missing.'
      );
    });

    it('does not leak service role key secret in error messages', () => {
      const secretKey = 'super-confidential-secret-key-xyz-987';
      try {
        validateStagingEnvironment({
          STAGING_SUPABASE_URL: 'https://invalid-host.com',
          STAGING_SERVICE_ROLE_KEY: secretKey,
          EXPECTED_STAGING_PROJECT_REF: validRef,
          CONFIRM_DISPOSABLE_DATABASE: 'true',
        });
      } catch (err) {
        expect(err instanceof Error).toBe(true);
        expect((err as Error).message).not.toContain(secretKey);
      }
    });
  });

  describe('Integration with runLiveDatabaseAudit in scripts/test-database-rls.ts', () => {
    beforeEach(() => {
      mockCreateClient.mockClear();
    });

    it('aborts runLiveDatabaseAudit before client creation when target validation fails', async () => {
      // Attempt run with empty environment
      await expect(runLiveDatabaseAudit({})).rejects.toThrow(
        'Target selection rejected: CONFIRM_DISPOSABLE_DATABASE must be explicitly set to "true"'
      );

      // Verify createClient was never called
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('aborts runLiveDatabaseAudit when only production credentials exist in environment', async () => {
      const prodOnlyEnv = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://production-ref-123456.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'prod-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'prod-service-role-key',
      };

      await expect(runLiveDatabaseAudit(prodOnlyEnv)).rejects.toThrow(
        'Target selection rejected: CONFIRM_DISPOSABLE_DATABASE must be explicitly set to "true"'
      );

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('aborts runLiveDatabaseAudit before client creation when STAGING_ANON_KEY is missing', async () => {
      await expect(runLiveDatabaseAudit(validEnv)).rejects.toThrow(
        'Target selection rejected: STAGING_ANON_KEY is missing or empty.'
      );

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('aborts runLiveDatabaseAudit before client creation when STAGING_ANON_KEY is empty or whitespace', async () => {
      await expect(runLiveDatabaseAudit({ ...validEnv, STAGING_ANON_KEY: '   ' })).rejects.toThrow(
        'Target selection rejected: STAGING_ANON_KEY is missing or empty.'
      );

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('aborts runLiveDatabaseAudit before client creation when STAGING_ANON_KEY contains template placeholders', async () => {
      await expect(
        runLiveDatabaseAudit({ ...validEnv, STAGING_ANON_KEY: 'your-staging-anon-key' })
      ).rejects.toThrow('Target selection rejected: STAGING_ANON_KEY contains template placeholder values.');

      await expect(
        runLiveDatabaseAudit({ ...validEnv, STAGING_ANON_KEY: 'your-anon-key' })
      ).rejects.toThrow('Target selection rejected: STAGING_ANON_KEY contains template placeholder values.');

      await expect(
        runLiveDatabaseAudit({ ...validEnv, STAGING_ANON_KEY: 'placeholder-key' })
      ).rejects.toThrow('Target selection rejected: STAGING_ANON_KEY contains template placeholder values.');

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('aborts runLiveDatabaseAudit before client creation when STAGING_ANON_KEY is identical to STAGING_SERVICE_ROLE_KEY', async () => {
      await expect(
        runLiveDatabaseAudit({ ...validEnv, STAGING_ANON_KEY: validKey })
      ).rejects.toThrow('Target selection rejected: STAGING_ANON_KEY must not be identical to STAGING_SERVICE_ROLE_KEY.');

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('does not leak STAGING_ANON_KEY secret in error messages', async () => {
      const secretAnonKey = 'super-confidential-anon-key-abc-123';
      try {
        await runLiveDatabaseAudit({
          ...validEnv,
          STAGING_ANON_KEY: secretAnonKey,
          STAGING_SERVICE_ROLE_KEY: secretAnonKey, // triggers identical keys rejection
        });
      } catch (err) {
        expect(err instanceof Error).toBe(true);
        expect((err as Error).message).not.toContain(secretAnonKey);
      }
    });
  });

  describe('runLiveMcpVerification Fail-Closed Staging Target Validation', () => {
    beforeEach(() => {
      mockCreateClient.mockClear();
    });

    it('aborts runLiveMcpVerification before client creation when CONFIRM_DISPOSABLE_DATABASE is missing or not true', async () => {
      await expect(
        runLiveMcpVerification({ ...validEnv, CONFIRM_DISPOSABLE_DATABASE: undefined })
      ).rejects.toThrow('Target selection rejected: CONFIRM_DISPOSABLE_DATABASE must be explicitly set to "true"');

      await expect(
        runLiveMcpVerification({ ...validEnv, CONFIRM_DISPOSABLE_DATABASE: 'false' })
      ).rejects.toThrow('Target selection rejected: CONFIRM_DISPOSABLE_DATABASE must be explicitly set to "true"');

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('aborts runLiveMcpVerification before client creation when STAGING_SUPABASE_URL is missing or invalid', async () => {
      await expect(
        runLiveMcpVerification({ ...validEnv, STAGING_SUPABASE_URL: undefined })
      ).rejects.toThrow('Target selection rejected: STAGING_SUPABASE_URL is missing.');

      await expect(
        runLiveMcpVerification({ ...validEnv, STAGING_SUPABASE_URL: 'http://localhost:54321' })
      ).rejects.toThrow('Target selection rejected: STAGING_SUPABASE_URL must use https protocol.');

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('aborts runLiveMcpVerification before client creation when EXPECTED_STAGING_PROJECT_REF does not match', async () => {
      await expect(
        runLiveMcpVerification({ ...validEnv, EXPECTED_STAGING_PROJECT_REF: 'differentref12345678' })
      ).rejects.toThrow('Target selection rejected: URL project reference');

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('purges ambient production credentials before executing target validation', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://production-ref.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'production-secret-service-role-key';

      try {
        await runLiveMcpVerification({
          ...validEnv,
          CONFIRM_DISPOSABLE_DATABASE: 'false', // causes fast rejection after purge
        });
      } catch {
        // Expected throw from validateStagingEnvironment
      }

      // Assert ambient production variables were purged
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    });

    it('does not leak STAGING_SERVICE_ROLE_KEY in error messages', async () => {
      const secretServiceKey = 'confidential-service-role-key-98765';
      try {
        await runLiveMcpVerification({
          ...validEnv,
          STAGING_SERVICE_ROLE_KEY: secretServiceKey,
          STAGING_SUPABASE_URL: undefined, // triggers missing URL error
        });
      } catch (err) {
        expect(err instanceof Error).toBe(true);
        expect((err as Error).message).not.toContain(secretServiceKey);
      }
    });
  });
});
