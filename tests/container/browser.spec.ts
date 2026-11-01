import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { parse } from 'dotenv';
import { z } from 'zod';

const root = process.env.CHATTERMOST_CONTAINER_TEST_ROOT;
if (!root) throw new Error('A disposable synthetic container installation is required');
const installation = z.object({ port: z.number().int(), server_url: z.string() }).parse(
  JSON.parse(readFileSync(path.join(root, 'installation.json'), 'utf8')) as unknown
);
if (!installation.server_url.startsWith('http://127.0.0.1:')) {
  throw new Error('Container browser proof is restricted to synthetic loopback installations');
}
const credentials = z.object({ ADMIN_USERNAME: z.string(), ADMIN_PASSWORD: z.string() }).parse(
  parse(readFileSync(path.join(root, 'secrets/runtime.env')))
);
const fixture = z.object({ admin_id: z.string(), channel_id: z.string(), post_id: z.string() }).parse(
  JSON.parse(readFileSync(path.join(root, 'synthetic-fixture.json'), 'utf8')) as unknown
);
const origin = `http://127.0.0.1:${installation.port}`;

test('published container keeps browser login, retained attachments and live WebSocket delivery after recovery', async ({ page }) => {
  await page.goto(`${origin}/login`);
  await page.getByLabel('Username or email').fill(credentials.ADMIN_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(credentials.ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('post-list')).toBeVisible();
  const me = z.object({ id: z.string() }).parse(await page.evaluate(async () => {
    const response = await fetch('/api/v4/users/me');
    if (!response.ok) throw new Error('Browser session is not authenticated');
    return await response.json() as unknown;
  }));
  expect(me.id).toBe(fixture.admin_id);
  const channel = z.object({ display_name: z.string() }).parse(await page.evaluate(async (channelId) => {
    const response = await fetch('/api/v4/channels/' + channelId);
    if (!response.ok) throw new Error('Retained channel is not accessible');
    return await response.json() as unknown;
  }, fixture.channel_id));
  await page.getByRole('button', { name: `#${channel.display_name}`, exact: true }).click();
  const retained = page.locator(`[data-post-id="${fixture.post_id}"]`);
  await expect(retained).toContainText('Synthetic distribution persistence proof');
  await expect(retained.getByRole('link', { name: 'Attachment synthetic.txt', exact: true })).toBeVisible();
  const marker = `Synthetic browser WebSocket proof ${Date.now()}`;
  const posted = await page.evaluate(async ({ channelId, message }) => {
    const response = await fetch('/api/v4/posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, message })
    });
    return response.ok;
  }, { channelId: fixture.channel_id, message: marker });
  expect(posted).toBeTruthy();
  await expect(page.getByTestId('post-list').getByText(marker, { exact: true })).toBeVisible();
});
