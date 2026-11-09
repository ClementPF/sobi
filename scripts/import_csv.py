#!/usr/bin/env python3
"""Turn the workout and drink spreadsheets (CSV) into SQL that imports them for one user.

Usage on the server, from the repo root:

    python3 scripts/import_csv.py --email you@example.com \
        --workouts Workout26.csv --drinks COOH26.csv \
      | docker compose -f docker-compose.prod.yml -f docker-compose.lan.yml \
          --env-file .env.production exec -T db psql -U sobi -d sobi -v ON_ERROR_STOP=1

Add --dry-run to print what would be imported and roll back. Re-running is safe: a day whose
imported session (12:00) or drinks (from 20:00) already exist is skipped.

Workouts CSV: the first row names an exercise per column; an empty header continues the
exercise to its left. The first column holds the date, every other cell the reps of one set.
A numeric header (the sheet's total-reps column) ends the exercise columns; a day with only
a total is imported as one set of "Other".
Drinks CSV: DATE, ABV (percent), V (CL) and an optional NOTES column. Rows without a usable
volume need --missing-volume-ml (and --missing-abv, default 40). Dates are dd/mm/yy,
dd/mm/yyyy or Excel serial numbers.
"""
import argparse
import csv
import re
import sys
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

EXCEL_EPOCH = date(1899, 12, 30)
OTHER = "Other"


class CsvError(Exception):
    pass


def parse_date(text, where):
    text = text.strip()
    if re.fullmatch(r"\d{4,5}", text):
        return EXCEL_EPOCH + timedelta(days=int(text))
    match = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})", text)
    if not match:
        raise CsvError(f"{where}: unreadable date {text!r}")
    day, month, year = (int(g) for g in match.groups())
    if year < 100:
        year += 2000
    try:
        return date(year, month, day)
    except ValueError as error:
        raise CsvError(f"{where}: invalid date {text!r} ({error})") from None


def parse_number(text, where):
    cleaned = text.strip().replace(",", ".").rstrip("%").strip()
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        raise CsvError(f"{where}: not a number {text!r}") from None


def read_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return [row for row in csv.reader(handle)]


def is_number(text):
    try:
        Decimal(text.strip().replace(",", "."))
        return True
    except InvalidOperation:
        return False


def parse_workouts(path):
    """Returns (exercise names in column order, [(date, [(exercise, reps), ...]), ...]).

    Exercise columns end at the first numeric header (the sheet's total-reps column); later
    summary columns are ignored. A day with a total but no sets becomes one OTHER set.
    """
    rows = read_rows(path)
    if not rows:
        return [], []
    columns = {}
    current = None
    total_col = None
    for index, cell in enumerate(rows[0][1:], start=1):
        if cell.strip() and is_number(cell):
            total_col = index
            break
        if cell.strip():
            current = cell.strip()
        if current:
            columns[index] = current
    exercises = list(dict.fromkeys(columns.values()))
    days = []
    seen = {}
    for line, row in enumerate(rows[1:], start=2):
        if not row or not row[0].strip():
            continue
        where = f"{path}:{line}"
        day = parse_date(row[0], where)
        if day in seen:
            raise CsvError(f"{where}: {row[0].strip()} is also on line {seen[day]}; fix one of them")
        seen[day] = line
        sets = []
        for index, cell in enumerate(row[1:], start=1):
            if index == total_col:
                break
            if not cell.strip():
                continue
            if index not in columns:
                raise CsvError(f"{where}: value in column {index + 1} has no exercise")
            reps = whole_reps(cell, f"{where} column {index + 1}")
            if reps > 0:
                sets.append((columns[index], reps))
        total_cell = row[total_col].strip() if total_col is not None and total_col < len(row) else ""
        if not sets and total_cell:
            total = whole_reps(total_cell, f"{where} total")
            if total > 0:
                sets.append((OTHER, total))
                if OTHER not in exercises:
                    exercises.append(OTHER)
        if sets:
            days.append((day, sets))
    return exercises, days


def whole_reps(cell, where):
    reps = parse_number(cell, where)
    if reps != reps.to_integral_value():
        raise CsvError(f"{where}: reps must be whole numbers")
    return int(reps)


def parse_drinks(path, fallback=None):
    """Returns [(date, abv percent, volume ml, note), ...]; volumes are given in centiliters.

    A row without a usable volume (blank, 0 or text) gets `fallback` = (abv, ml) when given.
    """
    rows = read_rows(path)
    if not rows:
        return []
    header = [cell.strip().lower() for cell in rows[0]]

    def column(*names, required=True):
        for i, cell in enumerate(header):
            if any(name in cell for name in names):
                return i
        if required:
            raise CsvError(f"{path}: missing a {names[0].upper()} column")
        return None

    date_col, abv_col, volume_col = column("date"), column("abv"), column("cl", "v ")
    note_col = column("note", required=False)
    drinks = []
    for line, row in enumerate(rows[1:], start=2):
        if not row or not any(cell.strip() for cell in row):
            continue
        where = f"{path}:{line}"
        cell = lambda i: row[i].strip() if i is not None and i < len(row) else ""
        day = parse_date(cell(date_col), where)
        note = cell(note_col) or None
        volume = cell(volume_col)
        if not is_number(volume) or Decimal(volume.replace(",", ".")) <= 0:
            if fallback is None:
                raise CsvError(f"{where}: no usable volume {volume!r}; see --missing-volume-ml")
            abv, volume_ml = fallback
            print(f"{where}: no volume, using {volume_ml} ml at {abv}% ({note or 'no note'})", file=sys.stderr)
        else:
            abv = parse_number(cell(abv_col), where)
            volume_ml = int((parse_number(volume, where) * 10).to_integral_value())
        if not 0 <= abv <= 100:
            raise CsvError(f"{where}: ABV {abv} is outside 0-100")
        drinks.append((day, abv, volume_ml, note))
    return drinks

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def local_time(day, clock, tz):
    return f"(timestamp {quote(f'{day.isoformat()} {clock}')} at time zone {quote(tz)})"


def build_sql(*, email, tz, workout_name, earn_drinks, earn_per, exercises, days, drinks, dry_run):
    out = [
        "begin;",
        "do $import$",
        "declare",
        "  uid uuid; wid uuid; sid uuid; eid uuid; ts timestamptz;",
        "  new_sessions int := 0; new_sets int := 0; new_drinks int := 0; skipped int := 0;",
        "  n int;",
        "begin",
        f"  select id into uid from users where lower(email) = lower({quote(email)});",
        f"  if uid is null then raise exception 'No user with email %', {quote(email)}; end if;",
        "  create temp table import_exercises (name text primary key, id uuid) on commit drop;",
    ]
    if days:
        out += [
            "  select id into wid from workouts",
            f"    where user_id = uid and name = {quote(workout_name)} and archived_at is null",
            "    order by created_at limit 1;",
            "  if wid is null then",
            f"    insert into workouts (user_id, name) values (uid, {quote(workout_name)})",
            "      returning id into wid;",
            "  end if;",
        ]
        for order, name in enumerate(exercises):
            out += [
                "  eid := null;",
                "  select id into eid from exercises",
                f"    where workout_id = wid and name = {quote(name)} and archived_at is null limit 1;",
                "  if eid is null then",
                "    insert into exercises (workout_id, name, metric, earn_drinks, earn_per, sort_order)",
                f"      values (wid, {quote(name)}, 'count', {earn_drinks}, {earn_per}, {order})",
                "      returning id into eid;",
                "  end if;",
                f"  insert into import_exercises values ({quote(name)}, eid);",
            ]
    for day, sets in days:
        values = ", ".join(
            f"({quote(name)}, {reps}, {i})" for i, (name, reps) in enumerate(sets)
        )
        out += [
            f"  ts := {local_time(day, '12:00', tz)};",
            "  if exists (select 1 from sessions where user_id = uid and workout_id = wid and started_at = ts) then",
            "    skipped := skipped + 1;",
            "  else",
            "    insert into sessions (user_id, workout_id, started_at, ended_at)",
            "      values (uid, wid, ts, ts + interval '1 hour') returning id into sid;",
            "    insert into set_entries (session_id, exercise_id, amount, earned_drinks, created_at)",
            "      select sid, e.id, v.amount,",
            "        round(v.amount::numeric / e.earn_per * e.earn_drinks, 4),",
            "        ts + v.ord * interval '1 second'",
            f"      from (values {values}) as v(name, amount, ord)",
            "      join import_exercises ie on ie.name = v.name",
            "      join exercises e on e.id = ie.id;",
            "    get diagnostics n = row_count;",
            "    new_sessions := new_sessions + 1; new_sets := new_sets + n;",
            "  end if;",
        ]
    by_day = {}
    for day, abv, volume_ml, note in drinks:
        by_day.setdefault(day, []).append((abv, volume_ml, note))
    for day, items in by_day.items():
        values = ", ".join(
            f"({abv}, {ml}, {i}, {quote(note) if note else 'null'})"
            for i, (abv, ml, note) in enumerate(items)
        )
        out += [
            f"  ts := {local_time(day, '20:00', tz)};",
            "  if exists (select 1 from drinks where user_id = uid and consumed_at = ts) then",
            "    skipped := skipped + 1;",
            "  else",
            "    insert into drinks (user_id, consumed_at, abv, volume_ml, alcohol_g, std_drinks, note)",
            "      select uid, ts + v.ord * interval '1 minute', v.abv, v.ml,",
            "        round(v.ml * v.abv / 100 * 0.789, 2),",
            "        round(v.ml * v.abv / 100 * 0.789 / 14, 4), v.note",
            f"      from (values {values}) as v(abv, ml, ord, note);",
            "    get diagnostics n = row_count;",
            "    new_drinks := new_drinks + n;",
            "  end if;",
        ]
    out += [
        "  raise notice 'Imported % sessions (% sets) and % drinks; skipped % days already imported',",
        "    new_sessions, new_sets, new_drinks, skipped;",
        "end",
        "$import$;",
        "rollback;" if dry_run else "commit;",
    ]
    return "\n".join(out) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True, help="Email of the Google account to import into")
    parser.add_argument("--workouts", type=Path, help="Workouts CSV")
    parser.add_argument("--drinks", type=Path, help="Drinks CSV")
    parser.add_argument("--tz", default="America/Los_Angeles", help="Time zone of the dates")
    parser.add_argument("--workout-name", default="Workout", help="Workout to import sessions into")
    parser.add_argument("--earn-drinks", type=Decimal, default=Decimal("3.6"))
    parser.add_argument("--earn-per", type=int, default=1000, help="Reps per --earn-drinks")
    parser.add_argument(
        "--missing-volume-ml",
        type=int,
        help="Volume for drink rows without a usable volume (otherwise they are an error)",
    )
    parser.add_argument(
        "--missing-abv", type=Decimal, default=Decimal("40"), help="ABV for those rows"
    )
    parser.add_argument("--dry-run", action="store_true", help="Roll back instead of committing")
    args = parser.parse_args(argv)
    if not args.workouts and not args.drinks:
        parser.error("give --workouts, --drinks or both")
    if args.earn_per <= 0 or args.earn_drinks < 0:
        parser.error("--earn-per must be positive and --earn-drinks non-negative")
    try:
        exercises, days = parse_workouts(args.workouts) if args.workouts else ([], [])
        fallback = (
            (args.missing_abv, args.missing_volume_ml) if args.missing_volume_ml else None
        )
        drinks = parse_drinks(args.drinks, fallback) if args.drinks else []
    except (CsvError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    sets = sum(len(s) for _, s in days)
    print(
        f"Parsed {len(days)} workout days ({sets} sets, exercises: {', '.join(exercises) or 'none'})"
        f" and {len(drinks)} drinks.",
        file=sys.stderr,
    )
    sys.stdout.write(
        build_sql(
            email=args.email,
            tz=args.tz,
            workout_name=args.workout_name,
            earn_drinks=args.earn_drinks,
            earn_per=args.earn_per,
            exercises=exercises,
            days=days,
            drinks=drinks,
            dry_run=args.dry_run,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
