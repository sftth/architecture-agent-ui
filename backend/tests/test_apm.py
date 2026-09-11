import json
import tempfile
import unittest
from pathlib import Path

from app.apm import load_collector


class CollectorConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.confirmed = Path(self.temp.name) / "output" / "demo" / "confirmed"
        self.confirmed.mkdir(parents=True)
        self.config = {
            "monitoring_targets": {
                "scouter": {
                    "common": {
                        "collector_ip": "10.0.0.10",
                        "tcp_port": 6100,
                        "scouter_home": "/opt/scouter",
                        "desktop_client": {"endpoint": "203.0.113.10:6200"},
                    },
                    "nodes": [
                        {"hostname": "app", "install_collector": False},
                        {
                            "hostname": "collector",
                            "install_collector": True,
                            "infra_ref": "infra_confirmed.json#/was_servers/0",
                        },
                    ],
                }
            }
        }

    def write_config(self, filename="monitoring_confirmed.json"):
        (self.confirmed / filename).write_text(json.dumps(self.config), encoding="utf-8")

    def test_monitoring_config_uses_desktop_endpoint_without_inline_node_ip(self):
        self.write_config()
        (self.confirmed / "infra_confirmed.json").write_text("{}", encoding="utf-8")
        collector, error = load_collector(self.temp.name, "demo")
        self.assertIsNone(error)
        self.assertEqual(collector.hostname, "collector")
        self.assertEqual((collector.ip, collector.tcp_port), ("203.0.113.10", 6200))
        self.assertEqual(collector.scouter_home, "/opt/scouter")

    def test_missing_monitoring_file_does_not_use_old_infra_config(self):
        self.write_config("infra_confirmed.json")
        collector, error = load_collector(self.temp.name, "demo")
        self.assertIsNone(collector)
        self.assertIn("output/demo/confirmed/monitoring_confirmed.json", error)

    def test_no_desktop_endpoint_uses_existing_address_fields(self):
        scouter = self.config["monitoring_targets"]["scouter"]
        del scouter["common"]["desktop_client"]
        for node_ip, expected in ((None, "10.0.0.10"), ("203.0.113.20", "203.0.113.20")):
            with self.subTest(node_ip=node_ip):
                scouter["nodes"][1]["ip"] = node_ip
                self.write_config()
                collector, error = load_collector(self.temp.name, "demo")
                self.assertIsNone(error)
                self.assertEqual((collector.ip, collector.tcp_port), (expected, 6100))

    def test_invalid_endpoint_reports_config_error(self):
        for endpoint in ("missing-port", ":6100", "host:abc", "host:0", "host:65536"):
            with self.subTest(endpoint=endpoint):
                self.config["monitoring_targets"]["scouter"]["common"]["desktop_client"]["endpoint"] = endpoint
                self.write_config()
                collector, error = load_collector(self.temp.name, "demo")
                self.assertIsNone(collector)
                self.assertIn("desktop_client.endpoint", error)

    def test_missing_scouter_and_invalid_json_name_monitoring_file(self):
        for content in ("{}", "invalid json"):
            with self.subTest(content=content):
                (self.confirmed / "monitoring_confirmed.json").write_text(content, encoding="utf-8")
                collector, error = load_collector(self.temp.name, "demo")
                self.assertIsNone(collector)
                self.assertIn("monitoring_confirmed.json", error)


if __name__ == "__main__":
    unittest.main()
