# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ghost-pair.spec.js >> desktop and ghost-phone pair via QR + PIN
- Location: tests\e2e\ghost-pair.spec.js:3:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('#btn-phone-pair')
    - locator resolved to <button id="btn-phone-pair" class="icon-button" data-tool="phone-pair" title="Live phone preview">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
      - waiting 100ms
    113 × waiting for element to be visible, enabled and stable
        - element is not visible
      - retrying click action
        - waiting 500ms

```

# Page snapshot

```yaml
- region "Login" [ref=e2]:
  - generic [ref=e3]:
    - img [ref=e5]
    - heading "Void" [level=1] [ref=e9]
    - paragraph [ref=e10]: Welcome to Void
    - button "Log In" [ref=e11] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('desktop and ghost-phone pair via QR + PIN', async ({ context }) => {
  4  |     const editor = await context.newPage();
  5  |     await editor.goto('/');
> 6  |     await editor.click('#btn-phone-pair');
     |                  ^ Error: page.click: Test timeout of 60000ms exceeded.
  7  | 
  8  |     // Wait for QR + PIN to render
  9  |     await editor.waitForFunction(() => window.__voidLastPhoneUrl?.length > 0, null, { timeout: 5000 });
  10 |     const phoneUrl = await editor.evaluate(() => window.__voidLastPhoneUrl);
  11 |     const pin = await editor.evaluate(() => document.getElementById('phone-pair-pin-value').textContent);
  12 |     expect(pin).toMatch(/^\d{4}$/);
  13 | 
  14 |     const phone = await context.newPage();
  15 |     await phone.goto(phoneUrl);
  16 |     for (const d of pin.split('')) {
  17 |         await phone.click(`.phone-pin-keypad button[data-key="${d}"]`);
  18 |     }
  19 |     await phone.click('#phone-pin-ok');
  20 | 
  21 |     // Editor should see modal close and pair-mode active
  22 |     await editor.waitForSelector('#phone-pair-modal.hidden', { timeout: 10000 });
  23 |     const paired = await editor.evaluate(() => document.body.classList.contains('viewport-paired'));
  24 |     expect(paired).toBe(true);
  25 | });
  26 | 
```