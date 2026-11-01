import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path

from omni_backend.core import Conflict, InsufficientStock, OmniCore, contribution


class ReservationTests(unittest.TestCase):
    def setUp(self):
        self.core = OmniCore()
        self.core.add_store("shop-a", "test", "Toko sintetis A")
        self.core.add_store("shop-b", "test", "Toko sintetis B")
        self.core.add_product("SKU/Size-M", "Produk sintetis")
        self.core.set_stock_snapshot("main", "SKU/Size-M", 5, 1, safety_stock=1)

    def tearDown(self):
        self.core.close()

    def reserve(self, order="o1", event="e1", qty=2, store="shop-a"):
        return self.core.reserve_order(store, order, event, "main", {"SKU/Size-M": qty})

    def test_duplicate_event_and_order_do_not_reserve_twice(self):
        first = self.reserve()
        self.assertEqual(first, self.reserve())
        self.assertEqual(first, self.reserve(event="e2"))
        self.assertEqual(2, self.core.inventory("main", "SKU/Size-M")["reserved"])
        with self.assertRaises(Conflict):
            self.reserve(qty=3)

    def test_order_identity_is_scoped_to_store(self):
        self.reserve(qty=2)
        self.reserve(qty=2, store="shop-b")
        self.assertEqual(0, self.core.inventory("main", "SKU/Size-M")["available"])

    def test_safety_stock_and_failed_multiline_order_are_atomic(self):
        self.core.add_product("SECOND", "Produk sintetis dua")
        self.core.set_stock_snapshot("main", "SECOND", 1, 1)
        with self.assertRaises(InsufficientStock):
            self.core.reserve_order("shop-a", "o1", "e1", "main", {"SKU/Size-M": 2, "SECOND": 2})
        self.assertEqual(0, self.core.db.execute("SELECT COUNT(*) FROM orders").fetchone()[0])
        self.assertEqual(0, self.core.db.execute("SELECT COUNT(*) FROM events").fetchone()[0])
        self.reserve(qty=4)
        with self.assertRaises(InsufficientStock):
            self.reserve(order="o2", event="e2", qty=1)

    def test_cancel_retry_and_late_create_do_not_reopen_order(self):
        self.reserve()
        self.core.cancel_order("shop-a", "o1", "c1")
        self.core.cancel_order("shop-a", "o1", "c1")
        self.core.cancel_order("shop-a", "o1", "c2")
        self.reserve(event="late-create")
        self.assertEqual(4, self.core.inventory("main", "SKU/Size-M")["available"])
        self.assertEqual("cancelled", self.core.db.execute("SELECT status FROM orders").fetchone()[0])

    def test_stale_stock_and_conflicting_version_are_rejected(self):
        self.core.set_stock_snapshot("main", "SKU/Size-M", 3, 2)
        self.assertFalse(self.core.set_stock_snapshot("main", "SKU/Size-M", 100, 1))
        with self.assertRaises(Conflict):
            self.core.set_stock_snapshot("main", "SKU/Size-M", 100, 2)
        self.assertEqual(3, self.core.inventory("main", "SKU/Size-M")["quantity"])

    def test_stock_reduction_exposes_shortage(self):
        self.reserve(qty=4)
        self.core.set_stock_snapshot("main", "SKU/Size-M", 2, 2)
        stock = self.core.inventory("main", "SKU/Size-M")
        self.assertEqual((0, 2), (stock["available"], stock["shortage"]))

    def test_mapping_is_variant_and_store_specific(self):
        self.core.add_product("SECOND", "Produk sintetis dua")
        self.core.map_listing("shop-a", "p1", "v1", "SKU/Size-M")
        self.core.map_listing("shop-a", "p1", "v1", "SKU/Size-M")
        self.core.map_listing("shop-b", "p1", "v1", "SECOND")
        with self.assertRaises(Conflict):
            self.core.map_listing("shop-a", "p1", "v1", "SECOND")

    def test_concurrent_orders_for_last_unit_have_one_winner(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.sqlite"
            setup = OmniCore(path)
            setup.add_store("shop", "test", "Toko sintetis")
            setup.add_product("LAST", "Stok terakhir")
            setup.set_stock_snapshot("main", "LAST", 1, 1)
            setup.close()
            barrier = threading.Barrier(2)

            def worker(number):
                core = OmniCore(path)
                try:
                    barrier.wait(timeout=10)
                    core.reserve_order("shop", str(number), str(number), "main", {"LAST": 1})
                    return True
                except InsufficientStock:
                    return False
                finally:
                    core.close()

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(worker, [1, 2]))
            self.assertEqual(1, sum(results))
            check = OmniCore(path)
            try:
                self.assertEqual(1, check.inventory("main", "LAST")["reserved"])
            finally:
                check.close()


class ContributionTests(unittest.TestCase):
    def test_missing_cogs_is_unknown_and_explicit_zero_is_distinct(self):
        self.assertIsNone(contribution("100", None, {})["amount"])
        self.assertEqual(Decimal("100"), contribution("100", "0", {})["amount"])

    def test_decimal_costs_preserve_negative_contribution(self):
        result = contribution("10.10", "9.20", {"fee": "1.11", "ads": "0.10"})
        self.assertEqual(Decimal("-0.31"), result["amount"])
        with self.assertRaises(ValueError):
            contribution("NaN", "1", {})


if __name__ == "__main__":
    unittest.main()
