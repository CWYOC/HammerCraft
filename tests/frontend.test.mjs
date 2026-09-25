import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { browserContext } from './helpers.mjs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });


function referenceDriver(d) {
    const driver = d.driver();
    Object.assign(driver, { databaseDriverId: 'db', responseAbsolute: true, referenceValidationMode: true,
        measurement: [100, 1000, 10000].map(frequency => ({ frequency, db: 90 })),
        measurementReferenceCompensation: true,
        measurementReferencePath: [{ element_type: 'tube', length_mm: 10, inner_diameter_mm: 2 }],
        measurementReferenceLoad: { type: 'anechoic' },
    });
    driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
    driver.circuit.output = 'in';
    d.state.drivers = [driver];
    return driver;
}

function reverseRequest(base) {
    return { base_request: base, target: [100, 1000, 10000].map(frequency_hz => ({ frequency_hz, db: 90, phase_deg: 0 })),
        driver_index: 0, min_tube_length_mm: 10, max_tube_length_mm: 10, min_tube_diameter_mm: 2, max_tube_diameter_mm: 2,
        damper_values: [0], capacitor_values_uf: [0], resistor_values_ohm: [0], gain_range_db: 0, max_evaluations: 200,
        result_count: 1, absolute_match: true };
}

test('reverse design includes the measured baseline and applies an electrically connected candidate', () => {
    const d = designer(); const driver = referenceDriver(d);
    const request = reverseRequest(d.rustRequest([100, 1000, 10000], true));
    const candidate = JSON.parse(engine.reverse_design_json(JSON.stringify(request)))[0];
    assert.ok(candidate.score_rmse_db < 0.001, JSON.stringify(candidate));
    assert.equal(d.rustRequest([1000]).drivers[0].response.length, 0, 'Forward path still composes its own baseline');
    d.applyRevPhysical(candidate, 0, false);
    const actual = JSON.parse(engine.simulate_json(JSON.stringify(d.rustRequest([1000], true))));
    assert.ok(Math.abs(actual.combined[0].db - 90) < 0.001);
    d.applyRevPhysical({ ...candidate, resistor_ohm: 16 }, 0, false);
    const attenuated = JSON.parse(engine.simulate_json(JSON.stringify(d.rustRequest([1000], true))));
    assert.ok(Math.abs(attenuated.combined[0].db - (90 - 20 * Math.log10(2))) < 0.001);
    assert.equal(driver.referenceValidationMode, false);
});

test('reverse request preserves calibrated magnitude and gain for every database driver', () => {
    const d = designer(); const driver = referenceDriver(d);
    driver.responseAbsolute = false; driver.sensitivity = 100; driver.gain = 3;
    d.state.drivers.push({ ...structuredClone(driver), id: 'second', gain: -2 });
    const request = d.rustRequest([1000], true);
    assert.equal(request.drivers[0].response[1].db, 100);
    assert.equal(request.drivers[0].gain_db, 3);
    assert.equal(request.drivers[1].gain_db, -2);
    assert.equal(request.drivers[0].response_absolute_spl, true);
});

test('validation failure survives normalization, hidden traces, and multiple drivers', () => {
    const d = designer(); const driver = referenceDriver(d);
    const response = driver.measurement.map(p => ({ ...p, db: p.db - 6 }));
    const validation = { pass: false, maxAbsDb: 6, rmsDb: 6, maxErrorFrequencyHz: 1000,
        minFrequencyHz: 100, maxFrequencyHz: 10000, errorCurve: [{ frequency: 1000, errorDb: -6 }] };
    d.state.last = { drivers: [response], combined: response, validation: [validation] };
    for (const mode of ['relative', 'absolute']) {
        d.document.getElementById('iemSplMode').value = mode;
        for (const checked of [true, false]) {
            d.document.getElementById('iemShowIndividual').checked = checked;
            d.draw();
            assert.equal(d.document.getElementById('iemValidationResult').textContent, '✕ FAIL');
            assert.equal(d.document.getElementById('iemValidationMax').textContent, '6.000 dB');
        }
    }
    d.state.drivers.push(structuredClone(driver));
    d.state.last.drivers.push(response); d.state.last.validation.push({ ...validation, pass: true, maxAbsDb: 0 });
    d.draw(); assert.equal(d.document.getElementById('iemValidationResult').textContent, '✕ FAIL');
});

test('PayPal return captures before loading the refreshed order and clears only payment URL parameters', async () => {
    const calls = []; let rewritten;
    const c = browserContext('docs/order.js', { location: { search: '?payment=return&hc_order=order-1&token=pp&PayerID=payer',
        href: 'https://example.test/order.html?payment=return&hc_order=order-1&token=pp&PayerID=payer' },
        history: { replaceState: (_s, _t, url) => { rewritten = url; } },
        hcSupabase: { auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
            functions: { invoke: async (name, { body }) => { calls.push([name, body.order_id]); return { data: { success: true } }; } } },
    });
    c.loadOrder = async id => calls.push(['load', id]);
    await c.initialiseOrder();
    assert.deepEqual(calls, [['paypal-capture-basket-order', 'order-1'], ['load', 'order-1']]);
    assert.equal(rewritten, '/order.html?hc_order=order-1');
    assert.equal(c.document.getElementById('retryPaymentButton').hidden, true);
});

test('failed payment confirmation retains a retry path and displays server recovery instructions', async () => {
    let attempts = 0;
    const c = browserContext('docs/order.js', { hcSupabase: { functions: { invoke: async () => {
        attempts++;
        return attempts === 1 ? { error: { context: { json: async () => ({ error: 'Paid at PayPal; retry confirmation.' }) } } }
            : { data: { success: true, stock_review_required: true } };
    } } } });
    c.loadOrder = async () => {};
    assert.equal(await c.confirmReturnedPayment('order-1'), false);
    assert.equal(c.document.getElementById('paymentMessage').textContent, 'Paid at PayPal; retry confirmation.');
    assert.equal(c.document.getElementById('retryPaymentButton').hidden, false);
    await c.document.getElementById('retryPaymentButton').onclick();
    assert.equal(attempts, 2);
    assert.match(c.document.getElementById('paymentMessage').textContent, /Payment received.*stock review/);
});

test('scan landing page lists only eligible orders belonging to the signed-in user', async () => {
    const filters = [];
    const orders = [{ id: 'fit', order_number: 'HC-1', status: 'paid', order_items: [{ custom_fit: true }] },
        { id: 'standard', status: 'paid', order_items: [{ custom_fit: false }] },
        { id: 'cancelled', status: 'cancelled', order_items: [{ custom_fit: true }] }];
    const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, order: async () => ({ data: orders }) };
    const c = browserContext('docs/ear-scan.js', { hcSupabase: { auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) }, from: () => q } });
    await c.initialiseEarScan();
    assert.deepEqual(filters, [['user_id', 'user-1']]);
    assert.equal(c.document.getElementById('scanOrderList').children.length, 1);
    assert.equal(c.document.getElementById('scanOrderList').children[0].href, 'ear-scan.html?order=fit');
    orders.length = 0; await c.chooseScanOrder();
    assert.match(c.document.getElementById('scanOrderSelectionMessage').textContent, /need a custom-fit order/);
});
