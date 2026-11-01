import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './helpers.js';

test('login, persistent cookie, logout, and invalid login failure', async ({ page }) => {
  await loginAsAdmin(page);
  await page.reload();
  await expect(page.getByTestId('post-list')).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'ChatterMost' })).toBeVisible();

  await page.getByLabel('Username or email').fill('admin');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('[data-error]')).toContainText('Invalid login credentials');
});
