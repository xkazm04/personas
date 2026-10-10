-- Fixture database for the HARD tier of the sql-helper family in
-- scripts/test/oneshot-model-bench.mjs. Built fresh into a temp file per run.
-- Every row exists to set one trap; the answer key is in sql-helper.hard.json
-- (`expected`, checked against `reference` on every --dry-run):
--   * `name`, `created_at` and `status` each exist in several tables
--     (an unqualified column in a join is an "ambiguous column" error);
--   * orders.created_at carries a TIME, and order 5 is at 2026-03-31 23:59, so
--     `BETWEEN '2026-03-01' AND '2026-03-31'` silently drops it;
--   * order_items.unit_price is what was charged and differs from
--     products.list_price;
--   * orders.discount is NULL for most orders (AVG skips NULLs);
--   * category Training has no products and Accessories sells only in a
--     cancelled order (an inner join or a WHERE on the outer side drops both);
--   * customers.referred_by points at customers.id (self-join).
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  list_price REAL NOT NULL
);
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  referred_by INTEGER REFERENCES customers(id),
  created_at TEXT NOT NULL
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  discount REAL
);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL
);
CREATE TABLE shipments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  carrier TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO categories VALUES
  (1, 'Hardware'),
  (2, 'Software'),
  (3, 'Services'),
  (4, 'Training'),
  (5, 'Accessories');

INSERT INTO products VALUES
  (1, 'Edge Router', 1, 300.0),
  (2, 'Mesh Node', 1, 120.0),
  (3, 'Rack Switch', 1, 900.0),
  (4, 'Analytics Suite', 2, 500.0),
  (5, 'Backup Agent', 2, 80.0),
  (6, 'Setup Visit', 3, 200.0),
  (7, 'Health Check', 3, 150.0),
  (8, 'Cable Pack', 5, 25.0);

INSERT INTO customers VALUES
  (1, 'Anna Novak', 'Prague', NULL, '2025-10-01 08:00:00'),
  (2, 'Ben Ortiz', 'Brno', 1, '2025-12-12 13:20:00'),
  (3, 'Chloe Ruiz', 'Prague', 1, '2026-01-05 09:45:00'),
  (4, 'Dan Weber', 'Vienna', 2, '2026-02-14 17:05:00'),
  (5, 'Eva Lind', 'Brno', NULL, '2026-02-28 10:10:00'),
  (6, 'Femi Ade', 'Vienna', 4, '2026-03-31 22:00:00'),
  (7, 'Gus Hale', 'Prague', 5, '2026-04-02 07:30:00'),
  (8, 'Hana Sato', 'Brno', NULL, '2026-05-20 15:00:00');

INSERT INTO orders VALUES
  (1, 1, '2026-01-03 09:15:00', 'paid', 0.10),
  (2, 1, '2026-02-11 14:00:00', 'paid', NULL),
  (3, 2, '2026-03-01 00:00:00', 'paid', 0.05),
  (4, 3, '2026-03-15 10:30:00', 'cancelled', NULL),
  (5, 1, '2026-03-31 23:59:00', 'paid', NULL),
  (6, 4, '2026-04-01 00:00:00', 'paid', 0.20),
  (7, 2, '2026-02-27 08:00:00', 'paid', NULL),
  (8, 5, '2026-03-20 16:45:00', 'refunded', NULL),
  (9, 6, '2026-04-15 12:00:00', 'pending', NULL),
  (10, 2, '2026-05-02 11:11:00', 'paid', 0.00),
  (11, 7, '2026-02-28 23:30:00', 'paid', NULL),
  (12, 3, '2026-04-30 09:00:00', 'paid', 0.15);

INSERT INTO order_items VALUES
  (1, 1, 1, 2, 280.0),
  (2, 1, 4, 1, 500.0),
  (3, 2, 2, 5, 110.0),
  (4, 2, 5, 3, 80.0),
  (5, 3, 3, 1, 850.0),
  (6, 3, 6, 1, 200.0),
  (7, 4, 8, 10, 25.0),
  (8, 4, 2, 2, 120.0),
  (9, 5, 4, 1, 450.0),
  (10, 5, 2, 1, 120.0),
  (11, 6, 7, 2, 150.0),
  (12, 6, 1, 1, 300.0),
  (13, 7, 5, 6, 75.0),
  (14, 8, 3, 1, 900.0),
  (15, 9, 6, 1, 200.0),
  (16, 10, 2, 4, 115.0),
  (17, 10, 7, 1, 150.0),
  (18, 11, 1, 1, 290.0),
  (19, 12, 4, 2, 480.0),
  (20, 12, 5, 1, 80.0);

INSERT INTO shipments VALUES
  (1, 1, 'DHL', 'delivered', '2026-01-05 10:00:00'),
  (2, 2, 'UPS', 'delivered', '2026-02-13 09:00:00'),
  (3, 3, 'DHL', 'returned', '2026-03-03 12:00:00'),
  (4, 5, 'DHL', 'in_transit', '2026-04-02 08:00:00'),
  (5, 6, 'UPS', 'delivered', '2026-04-03 15:30:00'),
  (6, 7, 'DHL', 'delivered', '2026-03-01 11:00:00'),
  (7, 10, 'UPS', 'returned', '2026-05-04 10:00:00'),
  (8, 11, 'DHL', 'delivered', '2026-03-02 16:00:00'),
  (9, 12, 'DHL', 'in_transit', '2026-05-01 09:00:00'),
  (10, 8, 'UPS', 'returned', '2026-03-22 14:00:00');
