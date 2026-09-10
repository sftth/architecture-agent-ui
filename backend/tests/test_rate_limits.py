import unittest

from app.rate_limits import parse_rate_limit


class CreditLimitTests(unittest.TestCase):
    def test_enterprise_overage(self):
        limit = parse_rate_limit({"utilization": .84, "rateLimitType": "overage", "resetsAt": 1800000000})
        self.assertEqual(limit.utilization, .84)
        self.assertEqual(limit.kind, "overage")
        self.assertEqual(limit.resets_at, 1800000000)

    def test_subscription_windows(self):
        limit = parse_rate_limit({"rateLimitType": "five_hour", "unifiedWindows": {
            "five_hour": {"utilization": .03}, "seven_day": {"utilization": .01},
            "seven_day_overage_included": {"utilization": .01},
        }})
        self.assertEqual(limit.utilization, .03)
        self.assertEqual(len(limit.windows), 3)

    def test_primary_window_wins_over_larger_window(self):
        limit = parse_rate_limit({"rateLimitType": "five_hour", "unifiedWindows": {
            "five_hour": {"utilization": 0}, "seven_day": {"utilization": .9},
        }})
        self.assertEqual(limit.utilization, 0)

    def test_missing_or_invalid_is_not_zero(self):
        for value in [None, "0.3", True, float("nan"), float("inf")]:
            self.assertIsNone(parse_rate_limit({"utilization": value}).utilization)

    def test_fallback_uses_most_consumed_window(self):
        limit = parse_rate_limit({"unifiedWindows": {
            "five_hour": {"utilization": .2}, "seven_day": {"utilization": .8},
        }})
        self.assertEqual(limit.kind, "seven_day")


if __name__ == "__main__":
    unittest.main()
