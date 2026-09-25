begin;

alter table public.orders
    add column if not exists stock_review_required boolean not null default false,
    add column if not exists stock_deducted_at timestamptz,
    add column if not exists checkout_basket_snapshot jsonb not null default '[]'::jsonb;

-- Called only by the payment function after verifying a completed PayPal capture.
-- The order lock makes retries idempotent; product locks serialize purchases.
create or replace function public.finalize_paypal_order(
    p_order_id uuid,
    p_user_id uuid,
    p_paypal_order_id text,
    p_capture_id text,
    p_amount numeric,
    p_currency text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    purchased public.orders%rowtype;
    needs_review boolean := false;
    paid_time timestamptz := now();
begin
    select * into purchased from public.orders
    where id = p_order_id and user_id = p_user_id
    for update;
    if not found then
        raise exception 'Order not found';
    end if;
    if purchased.paypal_order_id is distinct from p_paypal_order_id
        or purchased.total is distinct from p_amount
        or purchased.currency is distinct from p_currency
        or nullif(p_capture_id, '') is null then
        raise exception 'Payment does not match order';
    end if;
    if purchased.payment_status = 'paid' then
        if purchased.paypal_capture_id is distinct from p_capture_id then
            raise exception 'Capture does not match recorded payment';
        end if;
        return jsonb_build_object('success', true, 'already_paid', true,
            'order_id', purchased.id, 'order_number', purchased.order_number,
            'payment_status', 'paid', 'stock_review_required', purchased.stock_review_required);
    end if;

    -- Lock in a stable order, including products shared by concurrent checkouts.
    perform p.id from public.products p
    where p.id in (select i.product_id from public.order_items i
        where i.order_id = p_order_id and i.order_type = 'standard')
    order by p.id for update;

    select exists (
        select 1 from (
            select product_id, sum(quantity) as quantity
            from public.order_items
            where order_id = p_order_id and order_type = 'standard'
            group by product_id
        ) needed
        left join public.products p on p.id = needed.product_id
        where p.id is null or coalesce(p.stock_quantity, 0) < needed.quantity
            or needed.quantity is null or needed.quantity <= 0
    ) or not exists (select 1 from public.order_items where order_id = p_order_id)
    into needs_review;

    -- A completed payment is always recorded. A shortage holds the entire
    -- fulfilment for review without partially decrementing the other products.
    if not needs_review then
        update public.products p
        set stock_quantity = p.stock_quantity - needed.quantity, updated_at = paid_time
        from (
            select product_id, sum(quantity) as quantity
            from public.order_items
            where order_id = p_order_id and order_type = 'standard'
            group by product_id
        ) needed
        where p.id = needed.product_id;
    end if;

    update public.orders
    set status = 'paid', payment_status = 'paid', paypal_capture_id = p_capture_id,
        paid_at = paid_time, updated_at = paid_time,
        stock_review_required = needs_review,
        stock_deducted_at = case when needs_review then null else paid_time end
    where id = p_order_id;

    -- Remove only unchanged rows from this checkout, preserving later additions
    -- and edits. Older orders without a snapshot leave the basket untouched.
    delete from public.basket_items b
    using jsonb_array_elements(purchased.checkout_basket_snapshot) snapshot
    where b.user_id = p_user_id
        and b.id::text = snapshot->>'id'
        and b.product_id::text = snapshot->>'product_id'
        and b.quantity = (snapshot->>'quantity')::numeric
        and b.order_type::text = snapshot->>'order_type'
        and b.custom_fit is not distinct from (snapshot->>'custom_fit')::boolean
        and b.custom_tuning is not distinct from (snapshot->>'custom_tuning')::boolean;

    return jsonb_build_object('success', true, 'already_paid', false,
        'order_id', purchased.id, 'order_number', purchased.order_number,
        'payment_status', 'paid', 'stock_review_required', needs_review);
end;
$$;

revoke all on function public.finalize_paypal_order(uuid, uuid, text, text, numeric, text)
    from public, anon, authenticated;
grant execute on function public.finalize_paypal_order(uuid, uuid, text, text, numeric, text)
    to service_role;

commit;
