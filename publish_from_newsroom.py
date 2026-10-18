"""Publish approved GNS articles and political cartoons from Firestore.

Commands:
  python scripts/publish_from_newsroom.py add
  python scripts/publish_from_newsroom.py mark

Supported image fields on submissions:
  imageUrl / imageURL / image_url (hosted HTTPS URL)
  imageData / imageBase64 / image_data (data:image/...;base64,...)
  image (either a hosted URL or a data URL)

Prefer hosted HTTPS image URLs for large images. The script also supports data URLs
for compatibility with existing submissions, but these make index.html very large.
"""
import json
import os
import random
import re
import string
import sys
import textwrap
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

PROJECT = os.environ.get("FIREBASE_PROJECT", "gns-newsroom")
API_KEY = os.environ.get("FIREBASE_API_KEY", "")
SITE_FILE = os.environ.get("SITE_FILE", "index.html")
STATE = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "gns-published.json")
IMAGES_MARKER = "const IMAGES = {"
ARTICLES_MARKER = "const ARTICLES = ["
SECTION_IDS = {
    "U.S.": "us", "US": "us", "Politics": "politics",
    "Global Affairs": "global-affairs", "Elections": "elections",
    "Business": "business", "Opinion": "opinion",
    "Editorial Pieces": "editorial", "Cartoons": "cartoons",
}


def call(url, payload=None, method="GET"):
    if API_KEY:
        url += ("&" if "?" in url else "?") + "key=" + urllib.parse.quote(API_KEY, safe="")
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


def plain(value):
    for key in ("stringValue", "booleanValue", "doubleValue", "timestampValue"):
        if key in value:
            return value[key]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "arrayValue" in value:
        return [plain(item) for item in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {key: plain(item) for key, item in value["mapValue"].get("fields", {}).items()}
    return None


def fetch_approved():
    query = {"structuredQuery": {
        "from": [{"collectionId": "submissions"}],
        "where": {"fieldFilter": {
            "field": {"fieldPath": "status"},
            "op": "EQUAL",
            "value": {"stringValue": "approved"},
        }},
    }}
    rows = call(BASE + ":runQuery", query, "POST")
    results = []
    for row in rows:
        document = row.get("document")
        if document:
            results.append({"id": document["name"].rsplit("/", 1)[1],
                            **{key: plain(value) for key, value in document.get("fields", {}).items()}})
    return results


BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def fetch_cover(submission_id):
    """Read the separately stored cover image at covers/{submission_id}."""
    safe_id = urllib.parse.quote(str(submission_id), safe="")
    try:
        document = call(BASE + "/covers/" + safe_id)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    fields = document.get("fields", {})
    value = plain(fields.get("dataUrl", {}))
    return value if isinstance(value, str) and value.startswith("data:image/") else None


def slug_for(title):
    base = re.sub(r"[^a-z0-9]+", "-", str(title).lower()).strip("-")[:70].rstrip("-") or "story"
    return base + "-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


def body_blocks(text):
    blocks = []
    for block in re.split(r"\n\s*\n", str(text or "").replace("\r", "")):
        block = block.strip()
        if not block:
            continue
        if block.startswith("> "):
            blocks.append({"quote": [line for line in re.sub(r"(?m)^> ?", "", block).split("\n") if line]})
        elif block.startswith("## "):
            blocks.append(block[3:])
        else:
            blocks.append(block.replace("\n", " "))
    return blocks


def get_image(story):
    """Return (image key, image source); GNS stores uploaded covers separately."""
    source = story.get("_cover_data_url")
    if not (isinstance(source, str) and source.startswith("data:image/")):
        for key in ("imageData", "imageBase64", "image_data", "imageUrl", "imageURL", "image_url", "image"):
            value = story.get(key)
            if isinstance(value, str) and value.strip():
                candidate = value.strip()
                if candidate.startswith(("data:image/", "https://", "http://")):
                    source = candidate
                    break
    if not source:
        return None, None
    return "nr_" + re.sub(r"[^a-zA-Z0-9]", "", str(story["id"]))[:24], source


def js_object_entry(key, value):
    return "  " + json.dumps(key) + ": " + json.dumps(value, ensure_ascii=False) + ",\n"


def add():
    with open(SITE_FILE, encoding="utf-8") as file:
        html = file.read()
    if html.count(ARTICLES_MARKER) != 1:
        sys.exit(f"Expected exactly one '{ARTICLES_MARKER}' in {SITE_FILE}.")
    if html.count(IMAGES_MARKER) != 1:
        sys.exit(f"Expected exactly one '{IMAGES_MARKER}' in {SITE_FILE}.")

    submissions = fetch_approved()
    # The form stores the image in covers/{submissionId}, not on the submission itself.
    stories = [story for story in submissions
               if story.get("headline") and (story.get("body") or story.get("kind") == "cartoon"
                                               or story.get("section") == "Cartoons")]
    stories.sort(key=lambda item: str(item.get("reviewedAt") or item.get("createdAt") or item.get("submittedAt") or ""), reverse=True)

    now = datetime.now(timezone.utc)
    published = now.strftime("%B %-d, %Y %-I:%M %p UTC")
    entries, image_entries, ids = [], [], []
    existing_titles = set(re.findall(r'"title"\s*:\s*("(?:\\.|[^"\\])*")', html))

    for story in stories:
        title = str(story["headline"]).strip()
        title_json = json.dumps(title, ensure_ascii=False)
        is_cartoon = story.get("kind") == "cartoon" or story.get("section") == "Cartoons"

        # Images are in a separate Firestore document, keyed by the submission ID.
        story["_cover_data_url"] = fetch_cover(story["id"])
        image_key, image_source = get_image(story)

        # Don't mark a cartoon as published until its required image is available.
        if is_cartoon and not image_source and title_json not in existing_titles:
            print(f"Skipping cartoon {story['id']} ({title!r}): no cover image found in covers/{story['id']}")
            continue

        # Already on the site? It still needs its Firestore status changed to published.
        if title_json in existing_titles:
            ids.append(story["id"])
            continue

        if image_key and image_source:
            if re.search(r"(?m)^\s*" + re.escape(image_key) + r"\s*:", html) is None:
                image_entries.append((image_key, image_source))

        section = "cartoons" if is_cartoon else SECTION_IDS.get(story.get("section"), "politics")
        entry = {
            "slug": slug_for(title),
            "title": title,
            "sections": [section],
            "author": story.get("authorName") or story.get("author") or "",
            "role": story.get("authorTitle") or story.get("role") or "",
            "published": published,
            "body": body_blocks(story.get("body") or story.get("caption") or story.get("description") or ""),
        }
        if story.get("dek"):
            entry["dek"] = story["dek"]
        if story.get("tag"):
            entry["tag"] = story["tag"]
        if image_key:
            entry["image"] = image_key
            entry["imageAlt"] = story.get("imageAlt") or story.get("image_alt") or title
        entries.append(entry)
        ids.append(story["id"])
        existing_titles.add(title_json)

    # Insert image references inside the IMAGES object before its closing brace.
    if image_entries:
        image_start = html.index(IMAGES_MARKER) + len(IMAGES_MARKER)
        image_end = html.index("\n};", image_start)
        new_images = "".join(js_object_entry(key, value) for key, value in image_entries)
        html = html[:image_end] + "\n" + new_images.rstrip() + html[image_end:]

    if entries:
        article_start = html.index(ARTICLES_MARKER) + len(ARTICLES_MARKER)
        line_end = html.index("\n", article_start) + 1
        serialized = ",\n".join(textwrap.indent(json.dumps(entry, indent=2, ensure_ascii=False), "  ") for entry in entries) + ",\n"
        html = html[:line_end] + serialized + html[line_end:]

    if entries or image_entries:
        with open(SITE_FILE, "w", encoding="utf-8") as file:
            file.write(html)

    with open(STATE, "w", encoding="utf-8") as file:
        json.dump({"ids": ids, "at": now.isoformat()}, file)
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as file:
            file.write(f"changed={1 if entries or image_entries else 0}\n")
            file.write(f"count={len(ids)}\n")
    print(f"{len(entries)} stories/cartoons added, {len(image_entries)} images added, {len(ids)} submissions queued to mark live")


def mark():
    with open(STATE, encoding="utf-8") as file:
        state = json.load(file)
    for submission_id in state.get("ids", []):
        url = BASE + f"/submissions/{submission_id}?updateMask.fieldPaths=status&updateMask.fieldPaths=publishedAt"
        call(url, {"fields": {
            "status": {"stringValue": "published"},
            "publishedAt": {"stringValue": state["at"]},
        }}, "PATCH")
    print(f"Marked {len(state.get('ids', []))} submissions published")


if __name__ == "__main__":
    commands = {"add": add, "mark": mark}
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command not in commands:
        sys.exit(__doc__)
    commands[command]()
