PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
    sku TEXT PRIMARY KEY CHECK(length(trim(sku)) > 0),
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listing_mappings (
    store_id TEXT NOT NULL REFERENCES stores(id),
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    sku TEXT NOT NULL REFERENCES products(sku),
    PRIMARY KEY(store_id, product_id, variant_id)
);
CREATE TABLE IF NOT EXISTS stock (
    warehouse TEXT NOT NULL,
    sku TEXT NOT NULL REFERENCES products(sku),
    quantity INTEGER NOT NULL CHECK(quantity >= 0),
    safety_stock INTEGER NOT NULL CHECK(safety_stock >= 0),
    version INTEGER NOT NULL CHECK(version > 0),
    PRIMARY KEY(warehouse, sku)
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id),
    external_id TEXT NOT NULL,
    warehouse TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('reserved', 'cancelled')),
    payload_hash TEXT NOT NULL,
    UNIQUE(store_id, external_id)
);
CREATE TABLE IF NOT EXISTS order_lines (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    sku TEXT NOT NULL REFERENCES products(sku),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    PRIMARY KEY(order_id, sku)
);
CREATE INDEX IF NOT EXISTS order_lines_sku ON order_lines(sku);
CREATE TABLE IF NOT EXISTS events (
    store_id TEXT NOT NULL REFERENCES stores(id),
    event_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    PRIMARY KEY(store_id, event_id)
);
