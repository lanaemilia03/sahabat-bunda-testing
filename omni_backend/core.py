"""Atomic local reservations. Accept normalized records, never vendor credentials."""

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from typing import Mapping, Optional


class Conflict(ValueError):
    """An identity/version was reused with different contents."""


class InsufficientStock(ValueError):
    pass


def _identity(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Identitas harus berupa teks yang tidak kosong")
    return value  # Preserve case and punctuation in real marketplace SKU codes.


def _integer(value: int, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ValueError("Kuantitas/versi harus bilangan bulat dalam batas yang benar")
    return value


def _fingerprint(payload) -> str:
    value = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class OmniCore:
    def __init__(self, database=":memory:"):
        self.db = sqlite3.connect(str(database), isolation_level=None, timeout=15)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(Path(__file__).with_name("schema.sql").read_text())

    def close(self):
        self.db.close()

    @contextmanager
    def _transaction(self):
        # Serialize stock allocation, including allocations from other connections.
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self.db.rollback()
            raise
        else:
            self.db.commit()

    def add_store(self, store_id: str, channel: str, name: str):
        self.db.execute("INSERT INTO stores VALUES (?, ?, ?)",
                        tuple(map(_identity, (store_id, channel, name))))

    def add_product(self, sku: str, name: str):
        self.db.execute("INSERT INTO products VALUES (?, ?)",
                        (_identity(sku), _identity(name)))

    def map_listing(self, store_id: str, product_id: str, variant_id: str, sku: str):
        keys = tuple(map(_identity, (store_id, product_id, variant_id, sku)))
        with self._transaction():
            existing = self.db.execute(
                "SELECT sku FROM listing_mappings WHERE store_id=? AND product_id=? AND variant_id=?",
                keys[:3],
            ).fetchone()
            if existing:
                if existing["sku"] != sku:
                    raise Conflict("Varian sudah terkait ke SKU lain; perlu proses remap eksplisit")
                return
            self.db.execute("INSERT INTO listing_mappings VALUES (?, ?, ?, ?)", keys)

    def set_stock_snapshot(self, warehouse: str, sku: str, quantity: int,
                           version: int, safety_stock: int = 0) -> bool:
        """Adapter-local monotonic version; not an assumed Accurate API field.

        Caller must reconcile shipped orders before replacing physical stock.
        This foundation only supports unshipped orders and full cancellation.
        """
        _identity(warehouse)
        _identity(sku)
        _integer(quantity)
        _integer(version, 1)
        _integer(safety_stock)
        with self._transaction():
            old = self.db.execute("SELECT * FROM stock WHERE warehouse=? AND sku=?",
                                  (warehouse, sku)).fetchone()
            if old and version <= old["version"]:
                if version == old["version"] and (quantity, safety_stock) != (
                        old["quantity"], old["safety_stock"]):
                    raise Conflict("Versi stok yang sama memiliki isi berbeda")
                return False
            self.db.execute(
                "INSERT INTO stock VALUES (?, ?, ?, ?, ?) ON CONFLICT(warehouse, sku) "
                "DO UPDATE SET quantity=excluded.quantity, safety_stock=excluded.safety_stock, "
                "version=excluded.version", (warehouse, sku, quantity, safety_stock, version))
            return True

    def inventory(self, warehouse: str, sku: str) -> dict:
        # A single SQL statement provides a consistent physical/reservation view.
        row = self.db.execute(
            "SELECT s.quantity, s.safety_stock, s.version, "
            "COALESCE((SELECT SUM(l.quantity) FROM order_lines l JOIN orders o ON o.id=l.order_id "
            "WHERE l.sku=s.sku AND o.warehouse=s.warehouse AND o.status='reserved'), 0) AS reserved "
            "FROM stock s WHERE s.warehouse=? AND s.sku=?", (warehouse, sku)).fetchone()
        if not row:
            raise KeyError("Snapshot stok belum tersedia")
        result = dict(row)
        remainder = row["quantity"] - row["safety_stock"] - row["reserved"]
        result.update(available=max(0, remainder), shortage=max(0, -remainder))
        return result

    def _seen_event(self, store_id: str, event_id: str, fingerprint: str):
        row = self.db.execute("SELECT * FROM events WHERE store_id=? AND event_id=?",
                              (store_id, event_id)).fetchone()
        if row and row["payload_hash"] != fingerprint:
            raise Conflict("ID kejadian dipakai kembali untuk isi yang berbeda")
        return row

    def reserve_order(self, store_id: str, external_id: str, event_id: str,
                      warehouse: str, lines: Mapping[str, int]) -> int:
        for value in (store_id, external_id, event_id, warehouse):
            _identity(value)
        if not lines:
            raise ValueError("Pesanan harus memiliki baris")
        for sku, quantity in lines.items():
            _identity(sku)
            _integer(quantity, 1)
        order_hash = _fingerprint({"warehouse": warehouse, "lines": dict(lines)})
        event_hash = _fingerprint({"kind": "reserve", "order": external_id,
                                   "order_hash": order_hash})
        with self._transaction():
            seen = self._seen_event(store_id, event_id, event_hash)
            if seen:
                return seen["order_id"]
            existing = self.db.execute("SELECT * FROM orders WHERE store_id=? AND external_id=?",
                                       (store_id, external_id)).fetchone()
            if existing:
                if existing["payload_hash"] != order_hash:
                    raise Conflict("Isi order berubah; pembaruan harus melalui alur terpisah")
                order_id = existing["id"]
            else:
                for sku, quantity in lines.items():
                    if self.inventory(warehouse, sku)["available"] < quantity:
                        raise InsufficientStock("Stok tersedia tidak mencukupi: " + sku)
                cursor = self.db.execute(
                    "INSERT INTO orders(store_id, external_id, warehouse, status, payload_hash) "
                    "VALUES (?, ?, ?, 'reserved', ?)", (store_id, external_id, warehouse, order_hash))
                order_id = cursor.lastrowid
                self.db.executemany("INSERT INTO order_lines VALUES (?, ?, ?)",
                                    [(order_id, sku, qty) for sku, qty in lines.items()])
            self.db.execute("INSERT INTO events VALUES (?, ?, ?, ?)",
                            (store_id, event_id, event_hash, order_id))
            return order_id

    def cancel_order(self, store_id: str, external_id: str, event_id: str) -> int:
        for value in (store_id, external_id, event_id):
            _identity(value)
        fingerprint = _fingerprint({"kind": "cancel", "order": external_id})
        with self._transaction():
            seen = self._seen_event(store_id, event_id, fingerprint)
            if seen:
                return seen["order_id"]
            order = self.db.execute("SELECT * FROM orders WHERE store_id=? AND external_id=?",
                                    (store_id, external_id)).fetchone()
            if not order:
                raise KeyError("Order belum tersedia; simpan kejadian di antrean adapter")
            self.db.execute("UPDATE orders SET status='cancelled' WHERE id=?", (order["id"],))
            self.db.execute("INSERT INTO events VALUES (?, ?, ?, ?)",
                            (store_id, event_id, fingerprint, order["id"]))
            return order["id"]


def contribution(revenue: str, cogs: Optional[str], costs: Mapping[str, str]) -> dict:
    """Estimate contribution, not an official accounting profit statement.

    Each cost category must already be reconciled to prevent overlap. None means
    COGS is unavailable; zero is only valid when explicitly supplied as '0'.
    """
    if cogs is None:
        return {"status": "missing_cogs", "amount": None}
    values = [Decimal(revenue), Decimal(cogs)] + [Decimal(v) for v in costs.values()]
    if any(not value.is_finite() for value in values):
        raise ValueError("Nilai uang harus berhingga")
    return {"status": "estimate", "amount": values[0] - sum(values[1:], Decimal(0))}
