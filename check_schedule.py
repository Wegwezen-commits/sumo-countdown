#!/usr/bin/env python3
"""
check_schedule.py — weekly check for newly-published Japan Sumo
Association honbasho dates/results, sourced from the free, third-party
community API at https://www.sumo-api.com (NOT an official JSA feed —
see README.md for that distinction).

Pipeline:
  1. Load data/schedule.json + data/venues.json.
  2. Validate the existing schedule is internally consistent (15-day
     span, known venue id) — unchanged from the previous session.
  3. fetch_official_entries(): ask sumo-api.com about every basho id
     from last year through ~2 years out, using the standard
     Jan/Mar/May/Jul/Sep/Nov cadence. For any basho the API confirms is
     real (has dates back from the API, not just our own guess), build
     a schedule.json-shaped entry.
  4. Diff against schedule.json. Only ever *add or upgrade* entries —
     never delete, and never accept a diff that looks implausible.
  5. Fail safe: any network error, unexpected shape, or suspicious diff
     causes a clean no-op + log line, never a corrupted file.

sumo-api.com's exact JSON field names for GET /api/basho/:bashoId were
confirmed only at a schema level from public docs/examples at the time
this script was written (bashoId, a date range, and yusho/prize
details) — endpoints can change without notice since this is a
volunteer-run project. `_extract_basho_fields()` is written defensively
so a shape drift degrades to "skip this entry, log it" rather than a
crash or bad data.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEDULE_PATH = ROOT / "data" / "schedule.json"
VENUES_PATH = ROOT / "data" / "venues.json"

API_BASE = "https://www.sumo-api.com/api"
REQUEST_TIMEOUT = 10  # seconds
REQUEST_DELAY = 0.4  # be polite to a free, volunteer-run API

# JSA honbasho cadence: month -> (display name, romaji, venue id in
# this project's data/venues.json)
MONTH_INFO = {
    1: ("Hatsu Basho", "初場所", "ryogoku"),
    3: ("Haru Basho", "春場所", "edion-osaka"),
    5: ("Natsu Basho", "夏場所", "ryogoku"),
    7: ("Nagoya Basho", "名古屋場所", "ig-arena"),
    9: ("Aki Basho", "秋場所", "ryogoku"),
    11: ("Kyushu Basho", "九州場所", "fukuoka"),
}

# Loose city-name -> our venue id mapping, used only as a sanity check
# against MONTH_INFO's venue assumption (in case a venue ever changes).
CITY_TO_VENUE = {
    "tokyo": "ryogoku",
    "osaka": "edion-osaka",
    "nagoya": "ig-arena",
    "fukuoka": "fukuoka",
}

MAX_PLAUSIBLE_YEARS_OUT = 2


class FetchError(Exception):
    pass


def http_get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "sumo-basho-countdown-bot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            if resp.status != 200:
                raise FetchError(f"HTTP {resp.status} for {url}")
            body = resp.read().decode("utf-8")
        return json.loads(body)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            # A future/unpublished basho id — expected, not an error.
            return None
        raise FetchError(f"HTTP error {e.code} for {url}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise FetchError(f"Network error for {url}: {e}") from e
    except json.JSONDecodeError as e:
        raise FetchError(f"Malformed JSON from {url}: {e}") from e


def basho_id_for(year, month):
    return f"{year}{month:02d}"


def our_id_for(year, month):
    return f"{year}-{month:02d}"


def _first_present(d, keys):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _normalize_date(value):
    """Best-effort turn a handful of plausible date shapes into YYYY-MM-DD."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Some APIs give a full ISO datetime — take just the date part.
    if len(value) >= 10 and value[4] == "-" and value[7] == "-":
        return value[:10]
    return None


def _extract_basho_fields(raw):
    """Defensively pull whatever fields sumo-api.com actually returned.

    Returns a dict with keys we care about (any may be None if absent):
    startDate, endDate, champion, championJa, record, location
    """
    if not isinstance(raw, dict):
        return None

    start_raw = _first_present(raw, ["startDate", "dateStart", "start_date", "start"])
    end_raw = _first_present(raw, ["endDate", "dateEnd", "end_date", "end"])
    location = _first_present(raw, ["location", "venue", "city"])

    champion = None
    champion_ja = None
    record = None

    # Yusho / champion info can show up as a top-level object, a list of
    # per-division results, or nested under "yusho" — try the shapes
    # that are plausible from the public docs without assuming one.
    yusho = raw.get("yusho")
    candidates = []
    if isinstance(yusho, list):
        candidates = yusho
    elif isinstance(yusho, dict):
        candidates = [yusho]
    elif isinstance(raw.get("makuuchiYusho"), dict):
        candidates = [raw["makuuchiYusho"]]

    for c in candidates:
        if not isinstance(c, dict):
            continue
        division = str(_first_present(c, ["division", "type"]) or "").lower()
        if division and division not in ("makuuchi", ""):
            continue
        champion = champion or _first_present(c, ["shikonaEn", "rikishi", "wrestler", "winner", "name"])
        champion_ja = champion_ja or _first_present(c, ["shikonaJp", "shikonaJa", "nameJa"])
        record = record or _first_present(c, ["record", "score"])
        if champion:
            break

    return {
        "startDate": _normalize_date(start_raw) if start_raw else None,
        "endDate": _normalize_date(end_raw) if end_raw else None,
        "location": str(location) if location else None,
        "champion": str(champion) if champion else None,
        "championJa": str(champion_ja) if champion_ja else None,
        "record": str(record) if record else None,
    }


def fetch_official_entries(existing_ids, log=print):
    """Query sumo-api.com for basho beyond our last known entry.

    Returns a list of dicts shaped like schedule.json's `basho` entries.
    Returning [] is always safe: it means "nothing new/confirmed yet".
    Never raises — any problem is logged and treated as "no results".
    """
    now = datetime.utcnow()
    start_year = now.year - 1  # also re-check last year in case of late corrections
    end_year = now.year + MAX_PLAUSIBLE_YEARS_OUT

    found = []
    for year in range(start_year, end_year + 1):
        for month, (name, name_ja, venue_id) in MONTH_INFO.items():
            our_id = our_id_for(year, month)
            if our_id in existing_ids:
                continue  # already have this one, official or not worth re-checking here

            bid = basho_id_for(year, month)
            url = f"{API_BASE}/basho/{bid}"
            try:
                raw = http_get_json(url)
            except FetchError as e:
                log(f"  ! skip {our_id}: {e}")
                continue
            finally:
                time.sleep(REQUEST_DELAY)

            if raw is None:
                continue  # 404 — not published yet, expected for future basho

            fields = _extract_basho_fields(raw)
            if not fields or not fields["startDate"] or not fields["endDate"]:
                log(f"  ! {our_id}: API responded but didn't contain a usable date range, skipping")
                continue

            start = datetime.strptime(fields["startDate"], "%Y-%m-%d")
            end = datetime.strptime(fields["endDate"], "%Y-%m-%d")
            if (end - start) != timedelta(days=14):
                log(f"  ! {our_id}: fetched date range isn't a 15-day basho ({fields['startDate']}"
                    f" to {fields['endDate']}), skipping as implausible")
                continue

            # Sanity-check venue against location string if we got one.
            resolved_venue = venue_id
            if fields["location"]:
                loc_lower = fields["location"].lower()
                for city, vid in CITY_TO_VENUE.items():
                    if city in loc_lower:
                        resolved_venue = vid
                        break

            entry = {
                "id": our_id,
                "name": name,
                "nameJa": name_ja,
                "month": month,
                "year": year,
                "venueId": resolved_venue,
                "startDate": fields["startDate"],
                "endDate": fields["endDate"],
                "official": True,
                "status": "completed" if end < now else ("live" if start <= now <= end else "scheduled"),
            }
            if fields["champion"]:
                entry["champion"] = fields["champion"]
            if fields["championJa"]:
                entry["championJa"] = fields["championJa"]
            if fields["record"]:
                entry["record"] = fields["record"]

            found.append(entry)
            log(f"  + confirmed {our_id} ({fields['startDate']} to {fields['endDate']})"
                + (f", champion {fields['champion']}" if fields["champion"] else ""))

    return found


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def validate(schedule, venues):
    errors = []
    for entry in schedule["basho"]:
        try:
            start = datetime.strptime(entry["startDate"], "%Y-%m-%d")
            end = datetime.strptime(entry["endDate"], "%Y-%m-%d")
        except (KeyError, ValueError) as e:
            errors.append(f"{entry.get('id', '?')}: unparsable date(s) — {e}")
            continue
        if (end - start) != timedelta(days=14):
            errors.append(f"{entry['id']}: expected a 15-day span, got {(end - start).days + 1} days")
        if entry["venueId"] not in venues:
            errors.append(f"{entry['id']}: unknown venueId '{entry['venueId']}'")
    return errors


def merge(schedule, new_entries, log=print):
    """Merge fetched entries into schedule, fail-safe against bad diffs.

    Returns (updated_schedule, added_count, upgraded_count). On any
    implausible diff it returns the original schedule unchanged with
    added=upgraded=0 and logs why.
    """
    existing_by_id = {b["id"]: b for b in schedule["basho"]}
    result = json.loads(json.dumps(schedule))  # deep copy

    added = 0
    upgraded = 0
    for entry in new_entries:
        prior = existing_by_id.get(entry["id"])
        if prior is None:
            start = datetime.strptime(entry["startDate"], "%Y-%m-%d")
            if start.year > datetime.utcnow().year + MAX_PLAUSIBLE_YEARS_OUT:
                log(f"  ! refusing to add {entry['id']}: {start.year} is implausibly far out")
                continue
            result["basho"].append(entry)
            added += 1
        elif not prior.get("official"):
            # Upgrade a generated placeholder to a real, official entry —
            # but never overwrite an already-official entry (that would
            # be a silent data change, not a genuine addition).
            idx = next(i for i, b in enumerate(result["basho"]) if b["id"] == entry["id"])
            result["basho"][idx] = entry
            upgraded += 1
        # else: already official — leave it exactly as-is, don't touch it.

    if added == 0 and upgraded == 0:
        return schedule, 0, 0

    # Fail-safe: this pipeline only ever adds/upgrades, so a "deletion"
    # can only happen from a bug. Guard it anyway.
    if len(result["basho"]) < len(schedule["basho"]):
        log("  ! refusing merge: result would have fewer entries than before (should be impossible)")
        return schedule, 0, 0

    result["basho"].sort(key=lambda b: b["startDate"])
    result["lastVerified"] = datetime.utcnow().strftime("%Y-%m-%d")
    return result, added, upgraded


def main():
    schedule = load(SCHEDULE_PATH)
    venues = load(VENUES_PATH)

    errors = validate(schedule, venues)
    if errors:
        print("Validation FAILED:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("Validation OK.")

    existing_ids = {b["id"] for b in schedule["basho"]}
    print(f"Checking sumo-api.com for basho beyond/among our {len(existing_ids)} known entries...")

    try:
        new_entries = fetch_official_entries(existing_ids)
    except Exception as e:  # belt-and-braces: never let this crash the Action
        print(f"fetch_official_entries() raised unexpectedly, treating as no-op: {e}")
        new_entries = []

    if not new_entries:
        print("No new/confirmable official entries this run. schedule.json unchanged.")
        return

    updated, added, upgraded = merge(schedule, new_entries)
    if added == 0 and upgraded == 0:
        print("Fetched entries didn't yield a safe, non-empty diff. schedule.json unchanged.")
        return

    save(SCHEDULE_PATH, updated)
    print(f"Updated schedule.json: {added} new entr{'y' if added == 1 else 'ies'}, "
          f"{upgraded} placeholder(s) upgraded to official.")


if __name__ == "__main__":
    main()
