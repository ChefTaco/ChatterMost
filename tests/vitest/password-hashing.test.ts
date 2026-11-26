import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configurePasswordHashing, hashPassword, passwordNeedsRehash, verifyPassword } from '../../src/server/security.js';
import { createTestServer, type TestServer } from './helpers.js';

const PASSWORD = 'Synthetic-password-1';

/** A user whose stored hash is replaced with `hash`, as if written by an earlier release or mode. */
async function userWithHash(server: TestServer, username: string, hash: string): Promise<{ hashOf: () => string; signIn: (password: string) => Promise<Response> }> {
  const user = await server.services.users.createUser({ username, email: `${username}@example.test`, password: PASSWORD, role: 'system_user', actorUserId: null });
  await server.store.write((state) => {
    const stored = state.users.find((candidate) => candidate.id === user.id);
    if (stored !== undefined) stored.passwordHash = hash;
  });
  return {
    hashOf: () => server.store.read((state) => state.users.find((candidate) => candidate.id === user.id)?.passwordHash ?? ''),
    signIn: async (password: string) => server.app.request('/api/v4/users/login', { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ login_id: username, password }) })
  };
}

describe('password hashing with scrypt (the default)', () => {
  beforeEach(() => {
    configurePasswordHashing('scrypt');
  });

  it('hashes new passwords with scrypt and verifies them', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$scrypt\$ln=15,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('Synthetic-password-2', hash)).toBe(false);
    expect(passwordNeedsRehash(hash)).toBe(false);
    expect(await hashPassword(PASSWORD)).not.toBe(hash);
  });

  it('still verifies bcrypt hashes from earlier releases and marks them for rehashing', async () => {
    const legacy = await bcrypt.hash(PASSWORD, 4);
    expect(await verifyPassword(PASSWORD, legacy)).toBe(true);
    expect(await verifyPassword('wrong', legacy)).toBe(false);
    expect(passwordNeedsRehash(legacy)).toBe(true);
  });

  it('refuses malformed hashes and scrypt parameters outside the accepted range', async () => {
    const hash = await hashPassword(PASSWORD);
    for (const bad of ['', 'plain', '$scrypt$ln=30,r=8,p=1$c2FsdA$a2V5', hash.replace('ln=15', 'ln=25'), hash.slice(0, -4)]) {
      expect(await verifyPassword(PASSWORD, bad), bad).toBe(false);
    }
  });

  it('signs in a bcrypt user without a reset and replaces the hash with scrypt at that sign-in only', async () => {
    // No PASSWORD_HASHING: the default applies.
    const server = await createTestServer();
    try {
      const legacy = await bcrypt.hash(PASSWORD, 12);
      const user = await userWithHash(server, 'legacyuser', legacy);

      expect((await user.signIn('wrong-password')).status).toBe(400);
      expect(user.hashOf()).toBe(legacy);
      expect((await user.signIn(PASSWORD)).status).toBe(200);
      expect(user.hashOf()).toMatch(/^\$scrypt\$ln=15,r=8,p=1\$/u);
      // The replacement verifies, and later sign-ins keep it.
      const upgraded = user.hashOf();
      expect((await user.signIn(PASSWORD)).status).toBe(200);
      expect(user.hashOf()).toBe(upgraded);
      expect((await user.signIn('wrong-password')).status).toBe(400);
    } finally {
      await server.store.close();
    }
  });

  it('signs in a scrypt user and writes scrypt for new accounts', async () => {
    const server = await createTestServer();
    try {
      const current = await hashPassword(PASSWORD);
      const user = await userWithHash(server, 'scryptuser', current);
      expect((await user.signIn(PASSWORD)).status).toBe(200);
      expect(user.hashOf()).toBe(current);
      expect((await user.signIn('wrong-password')).status).toBe(400);

      const created = await server.services.users.createUser({ username: 'newuser', email: 'newuser@example.test', password: PASSWORD, role: 'system_user', actorUserId: null });
      expect(server.store.read((state) => state.users.find((candidate) => candidate.id === created.id)?.passwordHash)).toMatch(/^\$scrypt\$/u);
    } finally {
      await server.store.close();
    }
  });
});

describe('password hashing with PASSWORD_HASHING=bcrypt', () => {
  afterEach(() => {
    configurePasswordHashing('scrypt');
  });

  it('keeps writing bcrypt, which every release can verify, and does not rehash', async () => {
    configurePasswordHashing('scrypt');
    const scryptHash = await hashPassword(PASSWORD);
    configurePasswordHashing('bcrypt');
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$2[aby]\$12\$/u);
    expect(passwordNeedsRehash(hash)).toBe(false);
    // A scrypt hash written while scrypt was selected still verifies after switching back.
    expect(await verifyPassword(PASSWORD, scryptHash)).toBe(true);
    expect(passwordNeedsRehash(scryptHash)).toBe(false);
  });

  it('signs in bcrypt and scrypt users without changing their hashes', async () => {
    const server = await createTestServer({ PASSWORD_HASHING: 'bcrypt' });
    try {
      const legacy = await bcrypt.hash(PASSWORD, 4);
      const bcryptUser = await userWithHash(server, 'bcryptuser', legacy);
      expect((await bcryptUser.signIn(PASSWORD)).status).toBe(200);
      expect(bcryptUser.hashOf()).toBe(legacy);

      configurePasswordHashing('scrypt');
      const scryptHash = await hashPassword(PASSWORD);
      configurePasswordHashing('bcrypt');
      const scryptUser = await userWithHash(server, 'scryptkept', scryptHash);
      expect((await scryptUser.signIn(PASSWORD)).status).toBe(200);
      expect(scryptUser.hashOf()).toBe(scryptHash);

      const created = await server.services.users.createUser({ username: 'bcryptnew', email: 'bcryptnew@example.test', password: PASSWORD, role: 'system_user', actorUserId: null });
      expect(server.store.read((state) => state.users.find((candidate) => candidate.id === created.id)?.passwordHash)).toMatch(/^\$2[aby]\$12\$/u);
    } finally {
      await server.store.close();
    }
  });
});
