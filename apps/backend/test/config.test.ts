import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { testEnv } from './helpers.js';

const required = {
  DATABASE_URL: testEnv.DATABASE_URL,
  JWT_ACCESS_SECRET: testEnv.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: testEnv.JWT_REFRESH_SECRET,
  DEV_AUTH_SECRET: testEnv.DEV_AUTH_SECRET,
  GOOGLE_CLIENT_ID: testEnv.GOOGLE_CLIENT_ID,
};

describe('config', () => {
  it('provides local defaults for CORS and Google redirects', () => {
    const config = loadConfig(required);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:8083']);
    expect(config.GOOGLE_REDIRECT_ALLOWLIST).toEqual(['http://localhost:8083']);
    expect(config.PORT).toBe(3100);
  });

  it('parses CORS_ORIGINS as a trimmed CSV of exact origins', () => {
    const config = loadConfig({
      ...required,
      CORS_ORIGINS: ' https://sobi.example.com , ,http://localhost:8083/ ',
    });
    expect(config.CORS_ORIGINS).toEqual(['https://sobi.example.com', 'http://localhost:8083']);
  });

  it.each([
    ['a path', 'http://localhost:8083/app'],
    ['a wildcard', 'https://*.example.com'],
    ['a non-http scheme', 'ftp://example.com'],
    ['garbage', 'not a url'],
  ])('rejects a CORS origin with %s', (_label, origin) => {
    expect(() => loadConfig({ ...required, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
  });

  it('requires the secrets', () => {
    expect(() => loadConfig({ ...required, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
});
