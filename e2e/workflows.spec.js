import { test, expect } from '@playwright/test';
import { login, logout, shot, dialog, saved } from './helpers.js';

// Workflow tests mutate data, so they run once (desktop). Mobile runs the visual/smoke pass.
test.describe.configure({ mode: 'serial' });

test.describe('workflows', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'workflows run on desktop only'); });

  test('pastor sees the approval inbox and approves a request', async ({ page }, info) => {
    await login(page, 'pastor@orp.test');
    await expect(page.getByText('Approve: Food items for widows outreach')).toBeVisible();
    await page.goto('/finance/requests/r-food');
    await expect(page.getByRole('heading', { name: 'Food items for widows outreach' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await dialog(page).getByRole('button', { name: /Approve ₦120,000\.00/ }).click();
    await saved(page, 'Request approved');
    await expect(page.locator('.kv').getByText('Approved — unpaid')).toBeVisible();
    await shot(page, info, 'request-approved');
  });

  test('pastor asks for clarification and the requester resubmits', async ({ page }) => {
    await login(page, 'pastor@orp.test');
    await page.goto('/finance/requests/r-sound');
    await page.getByRole('button', { name: 'Ask for clarification' }).click();
    await dialog(page).getByLabel('What needs clarifying?').fill('Which model, and is there a cheaper option?');
    await dialog(page).getByRole('button', { name: 'Send question' }).click();
    await saved(page, 'Clarification requested');
    await expect(page.locator('.kv').getByText('Clarification requested')).toBeVisible();
    await logout(page);
    await login(page, 'youth@orp.test');
    await expect(page.getByText('Clarify your request: Wireless microphones (2)')).toBeVisible();
    await page.goto('/finance/requests/r-sound');
    await page.getByRole('button', { name: 'Respond and resubmit' }).click();
    await dialog(page).getByLabel('Amount (₦)').fill('140000');
    await dialog(page).getByLabel('Note for the pastor').fill('Shure BLX24 — cheapest reliable option.');
    await dialog(page).getByRole('button', { name: 'Save and resubmit' }).click();
    await expect(page.locator('.kv').getByText('Awaiting approval')).toBeVisible();
    await expect(page.locator('.kv').getByText('₦140,000.00')).toBeVisible();
  });

  test('finance officer records a partial payment and cannot overpay', async ({ page }, info) => {
    await login(page, 'finance@orp.test');
    await expect(page.getByText('Pay: Generator servicing and new battery')).toBeVisible();
    await page.goto('/finance/requests/r-generator');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await dialog(page).getByLabel('Amount (₦)').fill('50,000');
    await dialog(page).getByLabel('Receipt / reference').fill('TRF/TEST/001');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('.kv').getByText('Partly paid')).toBeVisible();
    await expect(page.getByText('TRF/TEST/001')).toBeVisible();
    await page.getByRole('button', { name: 'Record payment' }).click();
    await dialog(page).getByLabel('Amount (₦)').fill('60000');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page).getByText(/more than the amount still owed/)).toBeVisible();
    await dialog(page).getByLabel('Amount (₦)').fill('45000');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('.kv').getByText('Paid — completed')).toBeVisible();
    await page.goto('/finance');
    await shot(page, info, 'finance-overview');
    await page.goto('/finance?tab=ledger');
    await expect(page.getByText('TRF/TEST/001').first()).toBeVisible();
    await shot(page, info, 'finance-ledger');
    await page.goto('/finance?tab=reports');
    await shot(page, info, 'finance-reports');
  });

  test('pastor cannot approve more than a fund has available', async ({ page }) => {
    await login(page, 'youth@orp.test');
    await page.goto('/finance');
    await page.getByRole('button', { name: 'New request' }).click();
    const d = dialog(page);
    await d.getByLabel('Title').fill('Youth conference hall hire');
    await d.getByLabel('Fund').selectOption({ label: 'Youth Ministry' });
    await d.getByLabel('Amount (₦)').fill('500000');
    await expect(d.getByText(/currently available in this fund/)).toBeVisible();
    await d.getByLabel('Purpose and breakdown').fill('Hall hire for the regional youth conference.');
    await d.getByRole('button', { name: 'Submit for approval' }).click();
    await saved(page, 'Request submitted');
    await expect(page.getByRole('heading', { name: 'Youth conference hall hire' })).toBeVisible();
    await logout(page);
    await login(page, 'pastor@orp.test');
    await page.getByText('Approve: Youth conference hall hire').click();
    await expect(page.getByText(/can't be approved as it stands/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  });

  test('member books an appointment; the slot is no longer offered', async ({ page }, info) => {
    await login(page, 'member@orp.test');
    await page.goto('/meetings?tab=book');
    const first = page.locator('button.slot').first();
    const label = await first.locator('.t').innerText();
    const before = await page.locator('button.slot').count();
    await first.click();
    await dialog(page).getByLabel('Purpose').fill('Prayer and counsel about a new job');
    await dialog(page).getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByText('Prayer and counsel about a new job')).toBeVisible();
    await shot(page, info, 'my-appointments');
    await page.goto('/meetings?tab=book');
    await expect(page.locator('button.slot')).toHaveCount(before - 1);
    expect(label).toMatch(/\d\d:\d\d/);
  });

  test('member can reschedule and cancel', async ({ page }) => {
    await login(page, 'member@orp.test');
    await page.goto('/meetings?tab=mine');
    await page.getByRole('button', { name: 'Reschedule' }).first().click();
    await dialog(page).locator('button.slot').nth(2).click();
    await dialog(page).getByRole('button', { name: 'Confirm new time' }).click();
    await expect(dialog(page)).toHaveCount(0);
    const items = page.locator('.list-item');
    const n = await items.count();
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await dialog(page).getByLabel(/Reason/).fill('Travelling');
    await dialog(page).getByRole('button', { name: 'Cancel appointment' }).click();
    await expect(items).toHaveCount(n - 1);
  });

  test('ministry leader submits a report; reviewer requests revision', async ({ page }, info) => {
    await login(page, 'children@orp.test');
    await page.goto('/reports');
    await page.locator('.list-item', { hasText: 'Monthly Ministry Report' }).first().click();
    await page.getByRole('button', { name: 'Submit report' }).click();
    await expect(page.getByText(/Please answer:/)).toBeVisible();
    const vals = { 'Average attendance at meetings': '85', 'Number of meetings / activities held': '4', 'New members joined': '6' };
    for (const [k, v] of Object.entries(vals)) await page.getByLabel(k).fill(v);
    for (const k of ['Key activities this month', 'Achievements and testimonies', 'Challenges / issues needing attention', 'Requests to the Resident Pastor', 'Plans for next month']) {
      await page.getByLabel(k).fill('Children\'s harvest drama and Bible memory contest.');
    }
    await page.getByRole('button', { name: 'Submit report' }).click();
    await saved(page, 'Report submitted');
    await logout(page);
    await login(page, 'assistant@orp.test');
    await page.goto('/reports?tab=all');
    await page.locator('.list-item', { hasText: "Children's Church" }).first().click();
    await page.getByRole('button', { name: 'Request revision' }).click();
    await dialog(page).getByLabel('What needs revising?').fill('Please add the number of volunteers.');
    await dialog(page).getByRole('button', { name: 'Send back' }).click();
    await expect(page.getByText(/Revision requested by Grace Bello/)).toBeVisible();
    await page.goto('/reports?tab=summary');
    await expect(page.getByText('Totals')).toBeVisible();
    await shot(page, info, 'reports-summary');
  });

  test('pastor turns a report issue into a task; assignee completes it', async ({ page }) => {
    await login(page, 'pastor@orp.test');
    await page.goto('/reports?tab=all');
    await page.locator('select[aria-label="Filter"]').selectOption('reviewed');
    await page.locator('.list-item', { hasText: 'Youth Ministry' }).first().click();
    await page.getByRole('button', { name: '→ make task' }).first().click();
    await dialog(page).getByLabel('Due date').fill('2030-01-15');
    await dialog(page).getByRole('button', { name: 'Assign task' }).click();
    await saved(page, 'Task assigned');
    await logout(page);
    await login(page, 'youth@orp.test');
    await page.goto('/tasks');
    const row = page.locator('.list-item', { hasText: 'Youth Ministry:' }).first();
    await row.getByLabel('Status').selectOption('done');
    await expect(page.locator('.list-item', { hasText: 'Youth Ministry:' })).toHaveCount(0);
  });

  test('confidential areas and finance records are restricted', async ({ page }) => {
    await login(page, 'member@orp.test');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good/);
    await page.goto('/finance');
    await expect(page.getByRole('tab', { name: 'Ledger' })).toHaveCount(0);
    await expect(page.getByText('Food items for widows outreach')).toBeVisible();
    await expect(page.getByText('Youth retreat')).toHaveCount(0);
    await page.goto('/pastor');
    await expect(page.getByRole('tab', { name: 'Private notes' })).toHaveCount(0);
    await logout(page);
    await login(page, 'assistant@orp.test');
    await page.goto('/meetings?tab=notes');
    await expect(page.getByText('Meeting with Ushering & Protocol')).toBeVisible();
    await expect(page.getByText('Counselling session — confidential')).toHaveCount(0);
  });

  test('admin activates a new account with a role', async ({ page }, info) => {
    await login(page, 'admin@orp.test');
    await expect(page.getByText('Activate account: Ifeoma Obi')).toBeVisible();
    await page.goto('/admin');
    await page.locator('.list-item', { hasText: 'Ifeoma Obi' }).click();
    await dialog(page).getByLabel(/Ministry Leader/).check();
    await dialog(page).getByRole('button', { name: 'Activate' }).click();
    await expect(page.locator('.list-item', { hasText: 'Ifeoma Obi' }).getByText('Ministry Leader')).toBeVisible();
    await page.goto('/admin?tab=audit');
    await expect(page.getByText('user.updated').first()).toBeVisible();
    await shot(page, info, 'admin-audit');
  });

  test('branches are separate; the super admin can switch between them', async ({ page }) => {
    await login(page, 'abeokuta.pastor@orp.test');
    await expect(page.locator('.topbar')).toContainText('Abeokuta');
    await page.goto('/finance');
    await expect(page.getByText('No funds yet')).toBeVisible();
    await page.goto('/meetings?tab=diary');
    await expect(page.getByText('Tobi Adewale')).toHaveCount(0);
    await logout(page);
    await login(page, 'admin@orp.test');
    await page.locator('select.branch-switch').selectOption('abeokuta');
    await expect(page.locator('select.branch-switch')).toHaveValue('abeokuta');
    await page.goto('/admin');
    await expect(page.locator('.list-item', { hasText: 'Pastor Deji Ogunleye' })).toBeVisible();
    await expect(page.locator('.list-item', { hasText: 'Tobi Adewale' })).toHaveCount(0);
    await page.locator('select.branch-switch').selectOption('ijebu-ode');
    await expect(page.locator('.list-item', { hasText: 'Tobi Adewale' })).toBeVisible();
  });

  test('a brand new sign-up chooses a branch and waits for activation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Full name').fill('Test Volunteer');
    await page.getByLabel('Email').fill(`vol${Date.now()}@orp.test`);
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Which branch are you in?' })).toBeVisible();
    await page.getByText('The Elevation Church · Abeokuta').click();
    await expect(page.getByRole('heading', { name: 'Waiting for activation' })).toBeVisible();
    await expect(page.getByText(/administrator of The Elevation Church · Abeokuta/)).toBeVisible();
  });
});

test.describe('every page renders (visual pass)', () => {
  const pages = {
    'pastor@orp.test': ['/', '/finance', '/finance?tab=requests', '/meetings?tab=diary', '/meetings?tab=availability', '/meetings?tab=notes', '/reports?tab=all', '/pastor', '/pastor?tab=followups', '/pastor?tab=prayer', '/pastor?tab=notes', '/tasks', '/notifications', '/share'],
    'member@orp.test': ['/', '/finance', '/meetings?tab=book', '/pastor'],
    'youth@orp.test': ['/', '/reports', '/tasks'],
  };
  for (const [email, paths] of Object.entries(pages)) {
    test(`pages for ${email}`, async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g/.test(m.text())) errors.push(m.text()); });
      await login(page, email);
      for (const p of paths) {
        await page.goto(p);
        await expect(page.locator('.loading')).toHaveCount(0);
        await expect(page.locator('.error-note')).toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `horizontal overflow on ${p}`).toBeLessThanOrEqual(1);
        await shot(page, info, `${email.split('@')[0]}${p.replace(/[/?=]/g, '_')}`);
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});
