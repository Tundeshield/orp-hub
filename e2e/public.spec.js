import { test, expect } from '@playwright/test';
import { login, shot } from './helpers.js';

// The public side: no account, reached by scanning a QR code.
test('visitor sends a confidential prayer request without signing in', async ({ page }, info) => {
  await page.goto('/connect');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await shot(page, info, 'public-home');
  await page.getByText('Send a prayer request').click();
  await page.getByLabel('Your prayer request').fill(`Please pray for my exams next week (${info.project.name})`);
  await page.getByLabel('Your name (optional)').fill('Ade Visitor');
  await page.getByLabel(/Confidential/).check();
  await shot(page, info, 'public-prayer');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('heading', { name: 'We are praying with you' })).toBeVisible();
  // throttled: an immediate second request is refused politely
  await page.getByRole('button', { name: 'Send another' }).click();
  await page.getByLabel('Your prayer request').fill('Another one straight away');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/wait a minute/)).toBeVisible();
});

test('visitor books an appointment from the QR link', async ({ page }, info) => {
  await page.goto('/connect/book');
  await expect(page.getByRole('heading', { name: 'Book time with the Pastor' })).toBeVisible();
  await page.locator('button.slot').nth(info.project.name === 'desktop' ? 3 : 6).click();
  await page.getByLabel('Your full name').fill(`Mrs Funke Visitor ${info.project.name}`);
  await page.getByLabel('Phone number').fill('0805 123 4567');
  await page.getByLabel('What would you like to talk about?').fill('Family counselling');
  await shot(page, info, 'public-book-form');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add to my calendar/ })).toBeVisible();
  await shot(page, info, 'public-booked');
});

test('visitors cannot reach staff pages', async ({ page }) => {
  await page.goto('/connect');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the pastor sees public bookings and prayer requests', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await login(page, 'pastor@orp.test');
  await page.goto('/meetings?tab=diary');
  await expect(page.locator('.list-item', { hasText: 'Mrs Funke Visitor desktop' }).getByText('online booking')).toBeVisible();
  await page.goto('/pastor?tab=prayer');
  await expect(page.locator('.list-item', { hasText: 'Please pray for my exams next week (desktop)' }).getByText('via QR / public page')).toBeVisible();
  await page.goto('/share');
  await expect(page.locator('img.poster-qr')).toHaveCount(3);
  await shot(page, info, 'share-qr');
});
