const { test, expect } = require('@playwright/test');

// Discord widget: the demo answers /api/discord with you in a channel where Ada starts and stops speaking every 1.5 s.

const DISCORD = { id: 'd', type: 'discord', x: 0, y: 0, w: 6, h: 5, options: { control: true } };
const ONE_PAGE = [{ id: 'dc', title: 'Discord', enabled: true, widgets: [DISCORD] }];

async function show(page, { counting = false, pages = ONE_PAGE } = {}) {
  if (counting) {
    await page.addInitScript(() => {
      window.__dcRequests = 0;
      const wrap = () => {
        const f = window.fetch;
        if (!f || f.__dc) return;
        const g = (input, init) => {
          const url = typeof input === 'string' ? input : input.url;
          if (url.endsWith('/api/discord')) window.__dcRequests++;
          return f(input, init);
        };
        g.__dc = true;
        window.fetch = g;
      };
      setInterval(wrap, 10);
    });
  }
  await page.goto('/panel/');
  await page.evaluate((pages) => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, rules: [], shortcuts: [], pages }));
  }, pages);
  await page.reload();
}

test('a member who is speaking gets the ring, and loses it when they stop', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await show(page);
  const ada = page.locator('.dc-member', { hasText: 'Ada' });
  await expect(ada).toBeVisible();
  await expect(ada).toHaveClass(/speaking/, { timeout: 5000 });
  await expect(ada).not.toHaveClass(/speaking/, { timeout: 5000 });
  await expect(page.locator('.dc-member', { hasText: 'Linus' })).not.toHaveClass(/speaking/);
  expect(errors).toEqual([]);
});

test('the widget asks more often only while you are in a channel', async ({ page }) => {
  await show(page, { counting: true });
  await expect(page.locator('.dc-member').first()).toBeVisible();
  // in a channel: about every 500 ms (some 8 in 4 s; the bounds leave room for a busy test machine)
  let start = await page.evaluate(() => window.__dcRequests);
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__dcRequests) - start).toBeGreaterThanOrEqual(5);
  // out of the channel: back to every 2 s
  await page.locator('.dc-btn.leave').click();
  await expect(page.locator('.dc-member')).toHaveCount(0);
  start = await page.evaluate(() => window.__dcRequests);
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__dcRequests) - start).toBeLessThanOrEqual(3);
});

const requestsIn = async (page, ms) => {
  const start = await page.evaluate(() => window.__dcRequests);
  await page.waitForTimeout(ms);
  return await page.evaluate(() => window.__dcRequests) - start;
};

test('a widget on a neighbouring page does not ask until its page is shown', async ({ page }) => {
  // the panel keeps the pages next to the visible one up to date, so this one gets every update while off screen
  await show(page, { counting: true, pages: [
    { id: 'home', title: 'Home', enabled: true, widgets: [{ id: 'n', type: 'note', x: 0, y: 0, w: 6, h: 5, options: { text: 'Home' } }] },
    { id: 'dc', title: 'Discord', enabled: true, widgets: [DISCORD] },
  ] });
  await expect(page.locator('#dots i')).toHaveCount(2);
  expect(await requestsIn(page, 3000)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#dots i').nth(1)).toHaveClass('on');
  await expect(page.locator('.dc-member', { hasText: 'Ada' })).toBeVisible();
  expect(await requestsIn(page, 3000)).toBeGreaterThanOrEqual(4);
});

test('a Discord card that is not showing in a Smart Stack does not ask', async ({ page }) => {
  await show(page, { counting: true, pages: [{ id: 'st', title: 'Stack', enabled: true, widgets: [{ id: 's', type: 'stack', x: 0, y: 0, w: 6, h: 5,
    options: { interval: 0, widgets: [{ id: 'n', type: 'note', options: { text: 'Front' } }, { id: 'd', type: 'discord', options: { control: true } }] } }] }] });
  await expect(page.locator('.stack-item.active .w-note')).toBeVisible();
  expect(await requestsIn(page, 3000)).toBe(0);
});

test('the input mode button switches between voice activity and push to talk', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await show(page);
  const mode = page.locator('.dc-btn.mode');
  await expect(mode).toBeVisible();
  await expect(mode).not.toHaveClass(/\bon\b/);
  await expect(mode).toHaveAttribute('aria-label', 'Switch to push to talk');
  await mode.click();
  await expect(mode).toHaveClass(/\bon\b/);
  await expect(mode).toHaveAttribute('aria-label', 'Switch to voice activity');
  await expect(page.locator('.dc-warn')).toHaveCount(0); // the demo has a push-to-talk key
  await mode.click();
  await expect(mode).not.toHaveClass(/\bon\b/);
  expect(errors).toEqual([]);
});

test('push to talk without a key in Discord shows a warning', async ({ page }) => {
  // the agent reports pttKey: false when Discord has no push-to-talk key; the demo always has one, so drop it here
  await page.addInitScript(() => {
    const wrap = () => {
      const f = window.fetch;
      if (!f || f.__nokey) return;
      const g = async (input, init) => {
        const r = await f(input, init);
        const url = typeof input === 'string' ? input : input.url;
        if (!url.endsWith('/api/discord')) return r;
        const j = await r.clone().json();
        if (j.snapshot) j.snapshot.pttKey = false;
        return new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } });
      };
      g.__nokey = true;
      window.fetch = g;
    };
    setInterval(wrap, 10);
  });
  await show(page);
  await expect(page.locator('.dc-warn')).toHaveCount(0);
  await page.locator('.dc-btn.mode').click();
  await expect(page.locator('.dc-warn')).toHaveText(/no key is set in Discord/);
  await page.locator('.dc-btn.mode').click();
  await expect(page.locator('.dc-warn')).toHaveCount(0);
});

test('the ring moves without redrawing the widget, so avatars and server icons do not flash', async ({ page }) => {
  await show(page);
  const ada = page.locator('.dc-member', { hasText: 'Ada' });
  await expect(ada).toBeVisible();
  await page.locator('.w-discord .dc-ico').evaluateAll((icons) => icons.forEach((i) => { i.__kept = true; }));
  await expect(ada).toHaveClass(/speaking/, { timeout: 5000 });
  await expect(ada).not.toHaveClass(/speaking/, { timeout: 5000 });
  expect(await page.locator('.w-discord .dc-ico').evaluateAll((icons) => icons.every((i) => i.__kept === true))).toBe(true);
});
