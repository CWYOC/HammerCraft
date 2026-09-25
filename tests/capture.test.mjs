import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { read, quiet } from './helpers.mjs';

function captureHarness({ alreadyPaid = false, completed = false, pending = false, mismatch = false,
    finalizeFails = false, captureFailsAfterPayment = false, unauthorized = false, missingMigration = false } = {}) {
    const calls = []; let handler;
    const order = { id: 'order-1', order_number: 'HC-1', user_id: 'user-1', paypal_order_id: 'paypal-1',
        total: 20, currency: 'GBP', payment_status: alreadyPaid ? 'paid' : 'unpaid', stock_review_required: false };
    let captured = completed;
    const details = () => ({ status: captured ? 'COMPLETED' : 'APPROVED', purchase_units: [{ payments: { captures: captured
        ? [{ id: 'capture-1', status: pending ? 'PENDING' : 'COMPLETED', amount: { value: mismatch ? '1.00' : '20.00', currency_code: 'GBP' } }]
        : [] } }] });
    const query = { select() { return query; }, eq(key, value) { calls.push(['filter', key, value]); return query; },
        single: async () => missingMigration ? { error: { message: 'column missing' } } : { data: order } };
    const admin = { auth: { getUser: async () => unauthorized ? { data: {}, error: true } : { data: { user: { id: 'user-1' } } } },
        from: () => query,
        rpc: async (name, args) => {
            calls.push(['rpc', name, args]);
            return finalizeFails ? { error: { message: 'unavailable' } } : { data: { success: true, payment_status: 'paid' } };
        } };
    const context = { createClient: () => admin, Deno: { env: { get: () => 'fake' }, serve: fn => { handler = fn; } },
        Request, Response, btoa, console: quiet,
        fetch: async (url, options = {}) => {
            calls.push(['http', options.method || 'GET', url]);
            if (url.endsWith('/token')) return Response.json({ access_token: 'fake' });
            if (url.endsWith('/capture')) {
                captured = true;
                assert.equal(options.headers.Prefer, 'return=representation');
                assert.equal(options.headers['PayPal-Request-Id'], 'capture-order-1');
                if (captureFailsAfterPayment) throw new Error('lost response');
            }
            return Response.json(details());
        },
    };
    const source = read('supabase/functions/paypal-capture-basket-order/index.ts').replace(/^import[^;]+;/, '');
    vm.runInNewContext(stripTypeScriptTypes(source), context);
    return { calls, run: () => handler(new Request('https://example.test', { method: 'POST',
        headers: { Authorization: 'Bearer fake' }, body: JSON.stringify({ order_id: 'order-1' }) })) };
}

test('new payment verifies ownership and captures once before atomic finalization', async () => {
    const h = captureHarness(); const response = await h.run();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.ok(h.calls.some(c => c[0] === 'filter' && c[1] === 'user_id' && c[2] === 'user-1'));
    assert.equal(h.calls.filter(c => c[0] === 'http' && c[2].endsWith('/capture')).length, 1);
    assert.equal(h.calls.at(-1)[1], 'finalize_paypal_order');
    assert.equal(h.calls.at(-1)[2].p_capture_id, 'capture-1');
});

test('retry after successful capture uses PayPal lookup instead of recapturing', async () => {
    const h = captureHarness({ completed: true });
    assert.equal((await h.run()).status, 200);
    assert.equal(h.calls.filter(c => c[0] === 'http' && c[2].endsWith('/capture')).length, 0);
    assert.equal(h.calls.at(-1)[0], 'rpc');
});

test('lost capture response is reconciled before recording payment', async () => {
    const h = captureHarness({ captureFailsAfterPayment: true });
    assert.equal((await h.run()).status, 200);
    assert.equal(h.calls.filter(c => c[0] === 'rpc').length, 1);
});

test('already-paid retries perform no external payment or stock operations', async () => {
    const h = captureHarness({ alreadyPaid: true });
    assert.equal((await (await h.run()).json()).already_paid, true);
    assert.equal(h.calls.filter(c => ['http', 'rpc'].includes(c[0])).length, 0);
});

test('pending and mismatched payments are never finalized', async () => {
    for (const options of [{ pending: true }, { mismatch: true }]) {
        const h = captureHarness(options);
        assert.notEqual((await h.run()).status, 200);
        assert.equal(h.calls.filter(c => c[0] === 'rpc').length, 0);
    }
});

test('database failure after capture returns a recoverable confirmation error', async () => {
    const h = captureHarness({ finalizeFails: true }); const response = await h.run();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).retryable, true);
});

test('invalid sessions and missing migration fail before contacting PayPal', async () => {
    for (const options of [{ unauthorized: true }, { missingMigration: true }]) {
        const h = captureHarness(options);
        assert.notEqual((await h.run()).status, 200);
        assert.equal(h.calls.filter(c => c[0] === 'http').length, 0);
    }
});
