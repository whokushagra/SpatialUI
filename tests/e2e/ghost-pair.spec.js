import { test, expect } from '@playwright/test';

test('desktop and ghost-phone pair via QR + PIN', async ({ context }) => {
    const editor = await context.newPage();
    await editor.goto('/');
    await editor.click('#btn-phone-pair');

    // Wait for QR + PIN to render
    await editor.waitForFunction(() => window.__voidLastPhoneUrl?.length > 0, null, { timeout: 5000 });
    const phoneUrl = await editor.evaluate(() => window.__voidLastPhoneUrl);
    const pin = await editor.evaluate(() => document.getElementById('phone-pair-pin-value').textContent);
    expect(pin).toMatch(/^\d{4}$/);

    const phone = await context.newPage();
    await phone.goto(phoneUrl);
    for (const d of pin.split('')) {
        await phone.click(`.phone-pin-keypad button[data-key="${d}"]`);
    }
    await phone.click('#phone-pin-ok');

    // Editor should see modal close and pair-mode active
    await editor.waitForSelector('#phone-pair-modal.hidden', { timeout: 10000 });
    const paired = await editor.evaluate(() => document.body.classList.contains('viewport-paired'));
    expect(paired).toBe(true);
});
