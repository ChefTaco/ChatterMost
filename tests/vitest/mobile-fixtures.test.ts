import { describe, expect, it } from 'vitest';

import fixtures from '../fixtures/mobile-app-compatibility.json' with { type: 'json' };
import { createTestServer } from './helpers.js';

type MobileFixture = {
  name: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
  expected_status: number;
  expected_fields: string[];
  expected_token_header?: boolean;
};

describe('mobile app compatibility fixtures', () => {
  for (const fixture of fixtures as MobileFixture[]) {
    it(`replays ${fixture.name}`, async () => {
      const server = await createTestServer();
      const headers = new Headers(fixture.headers);
      if (fixture.body !== undefined) {
        headers.set('Content-Type', 'application/json');
      }
      const requestInit: RequestInit = {
        method: fixture.method,
        headers
      };
      if (fixture.body !== undefined) {
        requestInit.body = JSON.stringify(fixture.body);
      }
      const response = await server.app.request(fixture.path, requestInit);
      expect(response.status).toBe(fixture.expected_status);
      const body = (await response.json()) as Record<string, unknown>;
      for (const field of fixture.expected_fields) {
        expect(body, fixture.name).toHaveProperty(field);
      }
      if (fixture.name === 'mobile client config') {
        expect(body.DiagnosticId).toMatch(/^[a-z0-9]{26}$/u);
        expect(body.TelemetryId).toBe(body.DiagnosticId);
        expect(body.EnableSignInWithEmail).toBe('true');
        expect(body.EnableSignInWithUsername).toBe('true');
      }
      if (fixture.expected_token_header === true) {
        expect(response.headers.get('Token')).toBeTruthy();
      }
    });
  }
});
