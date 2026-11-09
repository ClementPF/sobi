import importlib.util
from datetime import date
from decimal import Decimal
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "import_csv", Path(__file__).resolve().parents[1] / "import_csv.py"
)
import_csv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_csv)


class CsvFiles(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def write(self, name, text):
        path = Path(self.dir.name) / name
        path.write_text(text, encoding="utf-8")
        return path


class ParseDateTest(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(import_csv.parse_date("01/02/26", "x"), date(2026, 2, 1))
        self.assertEqual(import_csv.parse_date("31/12/2026", "x"), date(2026, 12, 31))
        self.assertEqual(import_csv.parse_date("46023", "x"), date(2026, 1, 1))

    def test_rejects_garbage_and_impossible_dates(self):
        for text in ("tomorrow", "31/02/2026", "12/31/2026"):
            with self.assertRaises(import_csv.CsvError):
                import_csv.parse_date(text, "x")


class ParseWorkoutsTest(CsvFiles):
    def test_empty_headers_continue_the_previous_exercise(self):
        path = self.write(
            "w.csv",
            ",Dips,Dips,Abs,,G - abs,\n"
            "01/01/26,20,20,48,40,,\n"
            "02/01/26,,,,,10,12\n"
            "03/01/26,,,,,,\n",
        )
        exercises, days = import_csv.parse_workouts(path)
        self.assertEqual(exercises, ["Dips", "Abs", "G - abs"])
        self.assertEqual(
            days,
            [
                (date(2026, 1, 1), [("Dips", 20), ("Dips", 20), ("Abs", 48), ("Abs", 40)]),
                (date(2026, 1, 2), [("G - abs", 10), ("G - abs", 12)]),
            ],
        )

    def test_rejects_repeated_dates(self):
        path = self.write("w.csv", ",Dips\n04/03/26,20\n04/03/26,20\n")
        with self.assertRaisesRegex(import_csv.CsvError, "also on line 2"):
            import_csv.parse_workouts(path)

    def test_rejects_fractional_reps(self):
        path = self.write("w.csv", ",Dips\n01/01/26,2.5\n")
        with self.assertRaises(import_csv.CsvError):
            import_csv.parse_workouts(path)

    def test_summary_columns_end_exercises_and_total_only_days_become_other(self):
        path = self.write(
            "w.csv",
            ",Dips,,0,kg,completion\n"
            "01/01/26,20,20,40,79.7,58%\n"
            "02/01/26,,,600,,103%\n"
            ",100,,100,78.5,97%\n",
        )
        exercises, days = import_csv.parse_workouts(path)
        self.assertEqual(exercises, ["Dips", "Other"])
        self.assertEqual(
            days,
            [
                (date(2026, 1, 1), [("Dips", 20), ("Dips", 20)]),
                (date(2026, 1, 2), [("Other", 600)]),
            ],
        )

class ParseDrinksTest(CsvFiles):
    def test_converts_centiliters_keeps_zero_abv_and_notes(self):
        path = self.write(
            "d.csv",
            "DATE,ABV,V (CL),notes\n31/12/2026,0.0,47.3,\n01/01/2026,\"5,5\",33,o'neill's\n\n",
        )
        self.assertEqual(
            import_csv.parse_drinks(path),
            [
                (date(2026, 12, 31), Decimal("0.0"), 473, None),
                (date(2026, 1, 1), Decimal("5.5"), 330, "o'neill's"),
            ],
        )

    def test_rows_without_volume_need_a_fallback(self):
        path = self.write("d.csv", "DATE,ABV,V (CL),notes\n07/03/2026,x,x,tiki\n25/04/2026,,,\n")
        with self.assertRaises(import_csv.CsvError):
            import_csv.parse_drinks(path)
        self.assertEqual(
            import_csv.parse_drinks(path, (Decimal("40"), 44)),
            [
                (date(2026, 3, 7), Decimal("40"), 44, "tiki"),
                (date(2026, 4, 25), Decimal("40"), 44, None),
            ],
        )

    def test_rejects_out_of_range_abv(self):
        path = self.write("d.csv", "DATE,ABV,V (CL)\n01/01/2026,120,33\n")
        with self.assertRaises(import_csv.CsvError):
            import_csv.parse_drinks(path)

class BuildSqlTest(unittest.TestCase):
    def sql(self, **overrides):
        options = dict(
            email="o'brien@example.com",
            tz="America/Los_Angeles",
            workout_name="Workout",
            earn_drinks=Decimal("3.6"),
            earn_per=1000,
            exercises=["Dips"],
            days=[(date(2026, 1, 1), [("Dips", 20)])],
            drinks=[(date(2026, 12, 31), Decimal("5"), 473, "it's late")],
            dry_run=False,
        )
        options.update(overrides)
        return import_csv.build_sql(**options)

    def test_quotes_values_and_uses_local_times(self):
        sql = self.sql()
        self.assertIn("lower('o''brien@example.com')", sql)
        self.assertIn("timestamp '2026-01-01 12:00' at time zone 'America/Los_Angeles'", sql)
        self.assertIn("timestamp '2026-12-31 20:00' at time zone 'America/Los_Angeles'", sql)
        self.assertIn("'count', 3.6, 1000, 0", sql)
        self.assertIn("(5, 473, 0, 'it''s late')", sql)
        self.assertTrue(sql.rstrip().endswith("commit;"))

    def test_dry_run_rolls_back(self):
        self.assertTrue(self.sql(dry_run=True).rstrip().endswith("rollback;"))


class MainTest(CsvFiles):
    def test_requires_an_input_file(self):
        with self.assertRaises(SystemExit):
            import_csv.main(["--email", "a@b.c"])


if __name__ == "__main__":
    unittest.main()
