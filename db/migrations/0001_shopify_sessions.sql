-- Shopify session storage for the admin app.
-- Campaign data lives in Shopify metafields; this is the only app-owned table.

create table if not exists shopify_sessions (
  id text primary key,
  shop text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists shopify_sessions_shop_idx on shopify_sessions (shop);
