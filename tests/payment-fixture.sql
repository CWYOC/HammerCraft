-- Minimal existing-schema contract, used only in a disposable local cluster.
create role anon;
create role authenticated;
create role service_role;
create table public.products (id uuid primary key, stock_quantity integer not null, updated_at timestamptz);
create table public.orders (
    id uuid primary key, user_id uuid not null, order_number text, total numeric, currency text,
    status text, payment_status text, paypal_order_id text, paypal_capture_id text,
    paid_at timestamptz, updated_at timestamptz
);
create table public.order_items (
    id bigint generated always as identity primary key,
    order_id uuid references public.orders, product_id uuid, quantity integer, order_type text
);
create table public.basket_items (
    id uuid primary key, user_id uuid, product_id uuid, quantity integer,
    order_type text, custom_fit boolean, custom_tuning boolean
);
grant usage on schema public to service_role;
grant select, update, delete on all tables in schema public to service_role;
