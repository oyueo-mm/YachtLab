import itertools
import json
from pathlib import Path
import unittest
from train import YachtEnv, score


class RulesTest(unittest.TestCase):
    def test_boundaries(self):
        self.assertEqual(score([6] * 5, 8), 0)
        self.assertEqual(score([3, 3, 3, 2, 2], 8), 13)
        self.assertEqual(score([1, 2, 3, 4, 4], 9), 15)
        self.assertEqual(score([2, 3, 4, 5, 6], 10), 30)

    def test_mask_and_completion(self):
        env = YachtEnv(123)
        env.step(0); env.step(0)
        self.assertFalse(any(env.mask()[:32]))
        with self.assertRaises(ValueError):
            env.step(0)
        for c in range(12):
            _, _, done = env.step(32 + c)
            self.assertFalse(env.mask()[32 + c])
            self.assertEqual(done, c == 11)

    def test_export_parity_fixtures(self):
        # All 252 distinct dice multisets, all categories, exact TypeScript parity.
        fixtures = [{'values': list(values), 'scores': [score(list(values), c) for c in range(12)]} for values in itertools.combinations_with_replacement(range(1, 7), 5)]
        path = Path(__file__).resolve().parents[1] / 'tests/python-rules.json'
        path.write_text(json.dumps(fixtures, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    unittest.main()
