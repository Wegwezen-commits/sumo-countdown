#!/usr/bin/env python3
"""
test_check_schedule.py — offline tests for check_schedule.py's parsing
and merge logic, using saved fixture JSON rather than a live API call.
This is what lets the CI validate the pipeline's *logic* without
depending on sumo-api.com being reachable/unchanged at test time.

Run with: python3 scripts/test_check_schedule.py
Exits non-zero (and prints which assertion failed) on any failure.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_schedule as cs  # noqa: E402

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"

failures = []


def check(name, condition):
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}")
        failures.append(name)


def test_extract_basho_fields_happy_path():
    raw = json.loads((FIXTURES / "basho_202601_sample.json").read_text())
    fields = cs._extract_basho_fields(raw)
    check("extracts startDate", fields["startDate"] == "2026-01-11")
    check("extracts endDate", fields["endDate"] == "2026-01-25")
    check("extracts location", fields["location"] == "Tokyo")
    check("extracts makuuchi champion only", fields["champion"] == "Aonishiki")
    check("extracts championJa", fields["championJa"] == "安青錦")
    check("extracts record", fields["record"] == "12-3 (playoff)")


def test_extract_basho_fields_missing_data():
    check("handles non-dict input", cs._extract_basho_fields(None) is None)
    check("handles empty dict", cs._extract_basho_fields({})["startDate"] is None)
    check("handles no yusho key", cs._extract_basho_fields({"startDate": "2026-01-11", "endDate": "2026-01-25"})["champion"] is None)


def test_normalize_date_formats():
    check("iso format", cs._normalize_date("2026-01-11") == "2026-01-11")
    check("slash format", cs._normalize_date("2026/01/11") == "2026-01-11")
    check("full datetime", cs._normalize_date("2026-01-11T00:00:00Z") == "2026-01-11")
    check("garbage returns None", cs._normalize_date("not a date") is None)
    check("non-string returns None", cs._normalize_date(12345) is None)


def test_merge_adds_new_entry_only():
    schedule = {"basho": [
        {"id": "2026-01", "name": "Hatsu Basho", "month": 1, "year": 2026,
         "venueId": "ryogoku", "startDate": "2026-01-11", "endDate": "2026-01-25",
         "official": True, "status": "completed"}
    ]}
    new_entry = {"id": "2026-03", "name": "Haru Basho", "month": 3, "year": 2026,
                 "venueId": "edion-osaka", "startDate": "2026-03-08", "endDate": "2026-03-22",
                 "official": True, "status": "scheduled"}
    updated, added, upgraded = cs.merge(schedule, [new_entry], log=lambda *_: None)
    check("adds exactly one entry", added == 1 and upgraded == 0)
    check("total entries grew by one", len(updated["basho"]) == 2)
    check("original schedule dict untouched", len(schedule["basho"]) == 1)


def test_merge_upgrades_placeholder_not_official():
    schedule = {"basho": [
        {"id": "2027-01", "name": "Hatsu Basho", "month": 1, "year": 2027,
         "venueId": "ryogoku", "startDate": "2027-01-10", "endDate": "2027-01-24",
         "official": False, "status": "estimated"}
    ]}
    confirmed = {"id": "2027-01", "name": "Hatsu Basho", "month": 1, "year": 2027,
                 "venueId": "ryogoku", "startDate": "2027-01-10", "endDate": "2027-01-24",
                 "official": True, "status": "scheduled", "champion": None}
    updated, added, upgraded = cs.merge(schedule, [confirmed], log=lambda *_: None)
    check("upgrades rather than adds", added == 0 and upgraded == 1)
    check("entry is now official", updated["basho"][0]["official"] is True)


def test_merge_never_overwrites_official_entry():
    schedule = {"basho": [
        {"id": "2026-01", "name": "Hatsu Basho", "month": 1, "year": 2026,
         "venueId": "ryogoku", "startDate": "2026-01-11", "endDate": "2026-01-25",
         "official": True, "status": "completed", "champion": "Aonishiki"}
    ]}
    conflicting = {"id": "2026-01", "name": "Hatsu Basho", "month": 1, "year": 2026,
                   "venueId": "ryogoku", "startDate": "2026-01-11", "endDate": "2026-01-25",
                   "official": True, "status": "completed", "champion": "SomeoneElse"}
    updated, added, upgraded = cs.merge(schedule, [conflicting], log=lambda *_: None)
    check("does not touch already-official entries", added == 0 and upgraded == 0)
    check("champion unchanged", updated["basho"][0]["champion"] == "Aonishiki")


def test_merge_refuses_implausibly_far_future():
    schedule = {"basho": []}
    far_future = {"id": "2099-01", "name": "Hatsu Basho", "month": 1, "year": 2099,
                  "venueId": "ryogoku", "startDate": "2099-01-10", "endDate": "2099-01-24",
                  "official": True, "status": "scheduled"}
    updated, added, upgraded = cs.merge(schedule, [far_future], log=lambda *_: None)
    check("refuses implausible far-future entry", added == 0 and upgraded == 0)


def test_validate_catches_bad_span_and_unknown_venue():
    venues = {"ryogoku": {}}
    schedule = {"basho": [
        {"id": "bad-span", "startDate": "2026-01-11", "endDate": "2026-01-20", "venueId": "ryogoku"},
        {"id": "bad-venue", "startDate": "2026-01-11", "endDate": "2026-01-25", "venueId": "nowhere"},
    ]}
    errors = cs.validate(schedule, venues)
    check("flags wrong span length", any("15-day span" in e for e in errors))
    check("flags unknown venue", any("unknown venueId" in e for e in errors))


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        print(f"{t.__name__}:")
        t()
    print()
    if failures:
        print(f"{len(failures)} assertion(s) FAILED: {failures}")
        sys.exit(1)
    print("All check_schedule.py tests passed.")


if __name__ == "__main__":
    main()
