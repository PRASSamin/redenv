import { describe, it, expect } from 'vitest';
import { normalize, sanitizeName, nameValidator } from './index';

describe('Utility Functions', () => {
  describe('normalize', () => {
    it('should return an empty string for null', () => {
      expect(normalize(null)).toBe('');
    });

    it('should return an empty string for undefined', () => {
      expect(normalize(undefined)).toBe('');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(normalize('  hello world  ')).toBe('hello world');
    });

    it('should convert CRLF to LF line endings', () => {
      expect(normalize('line1\r\nline2')).toBe('line1\nline2');
    });

    it('should handle numbers by converting them to strings', () => {
      expect(normalize(123)).toBe('123');
    });
  });

  describe('sanitizeName', () => {
    it('should replace all colons with hyphens', () => {
      expect(sanitizeName('my:project:name')).toBe('my-project-name');
    });

    it('should not modify a string without colons', () => {
      expect(sanitizeName('my-project-name')).toBe('my-project-name');
    });

    it('should return the same value if it is undefined', () => {
      expect(sanitizeName(undefined)).toBeUndefined();
    });

    it('should handle an empty string', () => {
      expect(sanitizeName('')).toBe('');
    });
  });

  describe('nameValidator', () => {
    it('should return true for a valid name without colons', () => {
      expect(nameValidator('my-valid-project')).toBe(true);
    });

    it('should return an error message for a name containing a colon', () => {
      expect(nameValidator('my:invalid:project')).toBe(
        'Project and environment names cannot contain colons (:).'
      );
    });

    it('should return true for an empty string as it does not contain a colon', () => {
      expect(nameValidator('')).toBe(true);
    });
  });
});
