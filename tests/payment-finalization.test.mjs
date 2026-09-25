import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { read } from './helpers.mjs';

const exec = promisify(execFile);
const user = '10000000-0000-0000-0000-000000000001';
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const finalize = n => `select public.finalize_paypal_order('${uuid(n)}','${user}','pp-${n}','capture-${n}',20,'GBP');`;

test('atomic payment finalization in PostgreSQL', { timeout: 30000 }, async t => {
    for (const bin of ['initdb', 'pg_ctl', 'psql']) {
        try { execFileSync(bin, ['--version'], { stdio: 'pipe' }); }
        catch { t.skip(`Install PostgreSQL to run transaction tests (${bin} missing).`); return; }
    }
    const temp = mkdtempSync(join(tmpdir(), 'hc-payment-test-'));
    const data = join(temp, 'data');
    const env = { ...process.env, PGHOST: temp, PGUSER: 'postgres', PGDATABASE: 'postgres', PGPORT: '5432' };
    const sql = text => execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: text, env, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
    const setupOrder = (n, items) => sql(`insert into orders(id,user_id,order_number,total,currency,status,payment_status,paypal_order_id)
        values('${uuid(n)}','${user}','HC-${n}',20,'GBP','pending_payment','unpaid','pp-${n}');
        ${items.map(([p, qty, type = 'standard']) => `insert into order_items(order_id,product_id,quantity,order_type)
        values('${uuid(n)}','${uuid(p)}',${qty},'${type}');`).join('\n')}`);
    try {
        execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'pipe' });
        execFileSync('pg_ctl', ['-D', data, '-l', join(temp, 'postgres.log'), '-o', `-F -k ${temp} -h ''`, '-w', 'start'], { stdio: 'pipe' });
        sql(read('tests/payment-fixture.sql'));
        sql(read('supabase/migrations/202609250001_finalize_paypal_order.sql'));
        // The migration must also be safe to reapply.
        sql(read('supabase/migrations/202609250001_finalize_paypal_order.sql'));
        sql(`insert into products(id,stock_quantity) values('${uuid(101)}',5),('${uuid(102)}',0),('${uuid(103)}',1);`);

        await t.test('duplicate product lines aggregate, basket edits survive, retries do not decrement twice', () => {
            setupOrder(1, [[101,1],[101,1]]);
            const snapshot = [{ id: uuid(201), product_id: uuid(101), quantity: 2, order_type: 'standard', custom_fit: false, custom_tuning: false },
                { id: uuid(202), product_id: uuid(101), quantity: 1, order_type: 'standard', custom_fit: false, custom_tuning: false }];
            sql(`insert into basket_items values('${uuid(201)}','${user}','${uuid(101)}',2,'standard',false,false),
                ('${uuid(202)}','${user}','${uuid(101)}',3,'standard',false,false),
                ('${uuid(203)}','${user}','${uuid(101)}',1,'standard',false,false);
                update orders set checkout_basket_snapshot='${JSON.stringify(snapshot)}'::jsonb where id='${uuid(1)}';`);
            const first = JSON.parse(sql(`set role service_role; ${finalize(1)}`));
            assert.equal(first.stock_review_required, false);
            assert.equal(sql(`select stock_quantity from products where id='${uuid(101)}'`), '3');
            assert.equal(sql(`select count(*) from basket_items`), '2');
            assert.equal(JSON.parse(sql(finalize(1))).already_paid, true);
            assert.equal(sql(`select stock_quantity from products where id='${uuid(101)}'`), '3');
        });
        await t.test('stock shortage records payment and leaves all inventory unchanged', () => {
            setupOrder(2, [[101,1],[102,1]]);
            const result = JSON.parse(sql(finalize(2)));
            assert.equal(result.payment_status, 'paid'); assert.equal(result.stock_review_required, true);
            assert.equal(sql(`select stock_quantity from products where id='${uuid(101)}'`), '3');
            sql(finalize(2));
            assert.equal(sql(`select stock_quantity from products where id='${uuid(101)}'`), '3');
            assert.equal(sql(`select stock_deducted_at is null from orders where id='${uuid(2)}'`), 't');
        });
        await t.test('concurrent purchases cannot allocate the final unit twice', async () => {
            setupOrder(3, [[103,1]]); setupOrder(4, [[103,1]]);
            const run = text => exec('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text], { env });
            await Promise.all([run(`begin; ${finalize(3)} select pg_sleep(0.2); commit;`), run(finalize(4))]);
            assert.equal(sql(`select count(*) from orders where id in ('${uuid(3)}','${uuid(4)}') and stock_review_required`), '1');
            assert.equal(sql(`select stock_quantity from products where id='${uuid(103)}'`), '0');
            assert.equal(sql(`select count(*) from orders where id in ('${uuid(3)}','${uuid(4)}') and payment_status='paid'`), '2');
        });
        await t.test('concurrent retries of one order deduct once', async () => {
            setupOrder(5, [[101,1]]);
            const run = () => exec('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', finalize(5)], { env });
            const result = await Promise.all([run(),run()]);
            assert.equal(result.map(r=>JSON.parse(r.stdout)).filter(r=>r.already_paid).length, 1);
            assert.equal(sql(`select stock_quantity from products where id='${uuid(101)}'`), '2');
        });
        await t.test('preorders do not deduct stock and payment mismatch cannot change state', () => {
            setupOrder(6, [[102,1,'preorder']]);
            assert.equal(JSON.parse(sql(finalize(6))).stock_review_required, false);
            assert.equal(sql(`select stock_quantity from products where id='${uuid(102)}'`), '0');
            setupOrder(7, [[101,1]]);
            assert.throws(()=>sql(finalize(7).replace(",20,'GBP'", ",1,'GBP'")));
            assert.equal(sql(`select payment_status from orders where id='${uuid(7)}'`), 'unpaid');
        });
        await t.test('database errors roll back inventory, allowing a safe retry', () => {
            setupOrder(8, [[101,1]]);
            sql(`create function fail_order_update() returns trigger language plpgsql as $$
                begin raise exception 'simulated database failure'; end; $$;
                create trigger fail_order_update before update on orders for each row execute function fail_order_update();`);
            assert.throws(()=>sql(finalize(8)), /simulated database failure/);
            assert.equal(sql(`select stock_quantity from products where id='${uuid(101)}'`), '2');
            assert.equal(sql(`select payment_status from orders where id='${uuid(8)}'`), 'unpaid');
            sql('drop trigger fail_order_update on orders;');
            assert.equal(JSON.parse(sql(finalize(8))).success, true);
            assert.equal(sql(`select stock_quantity from products where id='${uuid(101)}'`), '1');
        });
        await t.test('customers cannot invoke payment finalization', () => {
            for (const role of ['anon','authenticated']) assert.throws(()=>sql(`set role ${role}; ${finalize(7)}`), /permission denied/);
        });
    } finally {
        try { execFileSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' }); } catch {}
        rmSync(temp, { recursive: true, force: true });
    }
});
