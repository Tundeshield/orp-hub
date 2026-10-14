import { expect } from '@playwright/test';

export const PASSWORD = 'Password123!';

export async function login(page, email) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
}

export async function logout(page) {
  await page.goto('/account');
  await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

export async function shot(page, testInfo, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}/${name}.png`, fullPage: true });
}

export const dialog = (page) => page.getByRole('dialog');
