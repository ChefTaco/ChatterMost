import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configurePasswordHashing, hashPassword, passwordNeedsRehash, verifyPassword } from '../../src/server/security.js';
import { createTestServer } from './helpers.js';

describe('password hashing with PASSWORD_HASHING=scrypt', () => {
  beforeEach(() => {
    configurePasswordHashing('scrypt');
  });
  afterEach(() => {
    configurePasswordHashing('bcrypt');
  });

  it('hashes new passwords with scrypt and verifies them', async () => {
    const hash = await hashPassword('Synthetic-password-1');
    expect(hash).toMatch(/^\$scrypt\$ln=15,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(await verifyPassword('Synthetic-password-1', hash)).toBe(true);
    expect(await verifyPassword('Synthetic-password-2', hash)).toBe(false);
    expect(passwordNeedsRehash(hash)).toBe(false);
    expect(await hashPassword('Synthetic-password-1')).not.toBe(hash);
  });

  it('still verifies bcrypt hashes from earlier releases and marks them for rehashing', async () => {
    const legacy = await bcrypt.hash('Synthetic-password-1', 4);
    expect(await verifyPassword('Synthetic-password-1', legacy)).toBe(true);
    expect(await verifyPassword('wrong', legacy)).toBe(false);
    expect(passwordNeedsRehash(legacy)).toBe(true);
  });

  it('refuses malformed hashes and scrypt parameters outside the accepted range', async () => {
    const hash = await hashPassword('Synthetic-password-1');
    for (const bad of ['', 'plain', '$scrypt$ln=30,r=8,p=1$c2FsdA$a2V5', hash.replace('ln=15', 'ln=25'), hash.slice(0, -4)]) {
      expect(await verifyPassword('Synthetic-password-1', bad), bad).toBe(false);
    }
  });

  it('replaces a bcrypt hash with scrypt at the next successful sign-in only', async () => {
    const server = await createTestServer({ PASSWORD_HASHING: 'scrypt' });
    try {
      const user = await server.services.users.createUser({ username: 'legacyuser', email: 'legacy@example.test', password: 'Synthetic-password-1', role: 'system_user', actorUserId: null });
      const legacy = await bcrypt.hash('Synthetic-password-1', 4);
      await server.store.write((state) => {
        const stored = state.users.find((candidate) => candidate.id === user.id);
        if (stored !== undefined) stored.passwordHash = legacy;
      });
      const hashOf = () => server.store.read((state) => state.users.find((candidate) => candidate.id === user.id)?.passwordHash ?? '');
      const signIn = (password: string) => server.app.request('/api/v4/users/login', { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ login_id: 'legacyuser', password }) });

      expect((await signIn('wrong-password')).status).toBe(400);
      expect(hashOf()).toBe(legacy);
      expect((await signIn('Synthetic-password-1')).status).toBe(200);
      expect(hashOf()).toMatch(/^\$scrypt\$/u);
      expect((await signIn('Synthetic-password-1')).status).toBe(200);
    } finally {
      await server.store.close();
    }
  });
});

describe('password hashing by default', () => {
  it('keeps writing bcrypt, which every release can verify, and does not rehash', async () => {
    configurePasswordHashing('bcrypt');
    const hash = await hashPassword('Synthetic-password-1');
    expect(hash).toMatch(/^\$2[aby]\$12\$/u);
    expect(passwordNeedsRehash(hash)).toBe(false);
    configurePasswordHashing('scrypt');
    const scryptHash = await hashPassword('Synthetic-password-1');
    configurePasswordHashing('bcrypt');
    // A scrypt hash written while scrypt was selected still verifies after switching back.
    expect(await verifyPassword('Synthetic-password-1', scryptHash)).toBe(true);
    expect(passwordNeedsRehash(scryptHash)).toBe(false);
  });
});
