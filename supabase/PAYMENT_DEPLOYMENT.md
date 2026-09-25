# Deploy the checkout fixes

Apply the database migration before deploying the two PayPal functions or publishing the updated website. No live database or PayPal account is changed by the local tests.

1. Run `supabase/migrations/202609250001_finalize_paypal_order.sql` in the existing project's Supabase SQL Editor. The migration is transactional and can be reapplied. It expects the existing `orders`, `order_items`, `products`, and `basket_items` tables used by the checkout, with UUID order/product/basket identifiers.
2. Deploy `paypal-create-basket-order` and `paypal-capture-basket-order` from this repository to the same Supabase project. If using the Supabase CLI:

   ```sh
   supabase functions deploy paypal-create-basket-order --project-ref oljniflqfchxaqamcxam
   supabase functions deploy paypal-capture-basket-order --project-ref oljniflqfchxaqamcxam
   ```

3. Publish the updated `docs/` directory through the site's existing GitHub Pages workflow. Include the new `docs/basket.css` file.
4. Exercise checkout against the PayPal sandbox before enabling live purchases: confirm a payment, reload its return page, and check that stock decreases only once. The local automated tests use simulated PayPal responses, not a real PayPal account.

Existing function secrets remain in use: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL`, and `SITE_URL`, plus the platform-provided Supabase environment variables. The default PayPal URL remains the sandbox. `SITE_URL` must be the website origin used for the PayPal return page.

## Payment recovery and stock review

Completed PayPal captures are looked up before attempting another capture. If a database write fails, the customer can retry confirmation on the same order; they should not create a replacement order. The database transaction records payment, deducts stock, and clears unchanged basket rows once, even when requests overlap.

If any standard-order line lacks stock, the transaction records the successful payment and sets `orders.stock_review_required = true`. It deducts no stock for that order and leaves `stock_deducted_at` empty. The customer sees a review notice; the capture function also logs the order ID. Review these orders before fulfilment:

```sql
select id, order_number, paid_at, total, currency, paypal_capture_id
from public.orders
where stock_review_required = true
order by paid_at;
```

Review availability and resolve allocation or refund manually. Repeating payment confirmation intentionally does not allocate inventory or clear the review flag. Check old payment incidents separately: the migration cannot infer whether the previous handler partially decremented stock. Existing paid orders are not reprocessed. Old pending orders without a basket snapshot leave the basket intact when recovered.

## Local regression checks

Use Node.js 22.18+ (the capture tests use native TypeScript stripping):

```sh
node --test tests/*.test.mjs
```

The transaction suite requires PostgreSQL's `initdb`, `pg_ctl`, and `psql` on `PATH`. It creates and removes a disposable cluster with a private Unix socket and no TCP listener. It does not connect to Supabase or an existing local database. The suite reports a skip if PostgreSQL is unavailable. The acoustic tests execute the checked-in WASM engine.
