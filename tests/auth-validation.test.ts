import { describe, it, expect } from 'vitest';
import {
  signInSchema,
  signUpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../src/lib/validation/auth';

describe('Authentication Validation Schemas', () => {
  describe('signInSchema', () => {
    it('accepts valid credentials', () => {
      const result = signInSchema.safeParse({
        email: 'alex@example.com',
        password: 'securePassword123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email formats', () => {
      const result = signInSchema.safeParse({
        email: 'not-an-email',
        password: 'securePassword123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Please enter a valid email address');
      }
    });

    it('rejects passwords shorter than 6 characters', () => {
      const result = signInSchema.safeParse({
        email: 'alex@example.com',
        password: '123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Password must be at least 6 characters');
      }
    });
  });

  describe('signUpSchema', () => {
    it('accepts valid signup data', () => {
      const result = signUpSchema.safeParse({
        fullName: 'Alex Developer',
        email: 'alex@example.com',
        password: 'strongPassword99',
      });
      expect(result.success).toBe(true);
    });

    it('enforces minimum 8 character password for new accounts', () => {
      const result = signUpSchema.safeParse({
        fullName: 'Alex Developer',
        email: 'alex@example.com',
        password: 'short7',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Password must be at least 8 characters');
      }
    });

    it('rejects empty or single character full name', () => {
      const result = signUpSchema.safeParse({
        fullName: 'A',
        email: 'alex@example.com',
        password: 'strongPassword99',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('forgotPasswordSchema', () => {
    it('validates email for password reset', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'user@domain.com' }).success).toBe(true);
      expect(forgotPasswordSchema.safeParse({ email: 'invalid' }).success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts matching passwords', () => {
      const result = resetPasswordSchema.safeParse({
        password: 'newSecurePassword123',
        confirmPassword: 'newSecurePassword123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects mismatched passwords', () => {
      const result = resetPasswordSchema.safeParse({
        password: 'newSecurePassword123',
        confirmPassword: 'differentPassword456',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Passwords do not match');
      }
    });
  });
});
