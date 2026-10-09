-- Fixture database for the single-turn SQL helper family of
-- scripts/test/oneshot-model-bench.mjs. Built fresh into a temp file per run;
-- the bench never writes the repo. Keep it small and its answers unambiguous.
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  signup_date TEXT NOT NULL
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL
);

INSERT INTO customers VALUES
  (1, 'Alder Systems', 'CZ', '2025-11-02'),
  (2, 'Birch & Co', 'DE', '2026-01-15'),
  (3, 'Cedar Labs', 'CZ', '2026-02-20'),
  (4, 'Dogwood Ltd', 'UK', '2026-03-05'),
  (5, 'Elm Studio', 'DE', '2026-06-30'),
  (6, 'Fir Analytics', 'FR', '2026-07-11');

INSERT INTO products VALUES
  (1, 'Sensor Kit', 'hardware', 120.0),
  (2, 'Gateway Pro', 'hardware', 480.0),
  (3, 'Cloud Plan Basic', 'subscription', 29.0),
  (4, 'Cloud Plan Team', 'subscription', 99.0),
  (5, 'Install Service', 'service', 250.0);

INSERT INTO orders VALUES
  (1, 1, '2026-01-10', 'paid'),
  (2, 1, '2026-03-02', 'paid'),
  (3, 2, '2026-02-01', 'paid'),
  (4, 3, '2026-03-15', 'refunded'),
  (5, 3, '2026-04-20', 'paid'),
  (6, 4, '2026-04-22', 'paid'),
  (7, 5, '2026-07-01', 'pending'),
  (8, 2, '2026-08-09', 'paid');

INSERT INTO order_items VALUES
  (1, 1, 1, 4),
  (2, 1, 3, 1),
  (3, 2, 2, 1),
  (4, 3, 4, 3),
  (5, 4, 2, 2),
  (6, 5, 1, 2),
  (7, 5, 5, 1),
  (8, 6, 4, 1),
  (9, 7, 2, 1),
  (10, 8, 1, 10);
