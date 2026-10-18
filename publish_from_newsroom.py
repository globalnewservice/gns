"""Publish approved GNS newsroom stories into the ARTICLES list in index.html.

  python scripts/publish_from_newsroom.py add    # insert approved stories into index.html
  python scripts/publish_from_newsroom.py mark   # mark them live in the newsroom (run after pushing)
"""
import json, os, random, re, string, sys, textwrap, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

PROJECT = os.environ.get("FIREBASE_PROJECT", "gns-newsroom")
API_KEY = os.environ.get("FIREBASE_API_KEY", "")
SITE_FILE = os.environ.get("SITE_FILE", "index.html")
STATE = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "gns-published.json")
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
MARKER = "const ARTICLES = ["
SECTION_IDS = {"U.S.": "us", "Politics": "politics", "Global Affairs": "global-affairs", "Elections": "elections",
               "Business": "business", "Opinion": "opinion", "Editorial Pieces": "editorial", "Cartoons": "cartoons"}


def call(url, payload=None, method="GET"):
    if API_KEY:
        url += ("&" if "?" in url else "?") + "key=" + API_KEY
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def plain(v):
    for k in ("stringValue", "booleanValue", "doubleValue", "timestampValue"):
        if k in v:
            return v[k]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "arrayValue" in v:
        return [plain(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: plain(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def fetch_approved():
    q = {"structuredQuery": {"from": [{"collectionId": "submissions"}], "where": {"fieldFilter": {
         "field": {"fieldPath": "status"}, "op": "EQUAL", "value": {"stringValue": "approved"}}}}}
    out = []
    for row in call(BASE + ":runQuery", q, "POST"):
        d = row.get("document")
        if d:
            out.append({"id": d["name"].rsplit("/", 1)[1], **{k: plain(v) for k, v in d.get("fields", {}).items()}})
    return out


def slug_for(title):
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:70].rstrip("-")
    return base + "-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


def body_blocks(text):
    blocks = []
    for b in re.split(r"\n\s*\n", text.replace("\r", "")):
        b = b.strip()
        if not b:
            continue
        if b.startswith("> "):
            blocks.append({"quote": [l for l in re.sub(r"(?m)^> ?", "", b).split("\n") if l]})
        elif b.startswith("## "):
            blocks.append(b[3:])          # subheadings become plain paragraphs for now
        else:
            blocks.append(b.replace("\n", " "))
    return blocks


def add():
    html = open(SITE_FILE, encoding="utf-8").read()
    if html.count(MARKER) != 1:
        sys.exit(f"Expected exactly one '{MARKER}' in {SITE_FILE}.")
    stories = [s for s in fetch_approved() if s.get("kind") != "cartoon" and s.get("headline") and s.get("body")]
    stories.sort(key=lambda s: str(s.get("reviewedAt") or ""), reverse=True)
    now = datetime.now(ZoneInfo("America/New_York"))
    published = now.strftime("%B %-d, %Y %-I:%M %p") + " EST"
    entries, ids = [], []
    for s in stories:
        ids.append(s["id"])
        if '"title": ' + json.dumps(s["headline"], ensure_ascii=False) in html:
            continue                      # already on the site; only needs marking live
        entries.append({"slug": slug_for(s["headline"]), "title": s["headline"],
                        "sections": [SECTION_IDS.get(s.get("section"), "politics")],
                        "author": s.get("authorName", ""), "role": s.get("authorTitle") or "",
                        "published": published, "body": body_blocks(s["body"])})
    if entries:
        text = ",\n".join(textwrap.indent(json.dumps(e, indent=2, ensure_ascii=False), "  ") for e in entries) + ",\n"
        at = html.index("\n", html.index(MARKER)) + 1
        open(SITE_FILE, "w", encoding="utf-8").write(html[:at] + text + html[at:])
    json.dump({"ids": ids, "at": now.isoformat()}, open(STATE, "w"))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={1 if entries else 0}\ncount={len(ids)}\n")
    print(f"{len(entries)} added, {len(ids)} to mark live")


def mark():
    st = json.load(open(STATE))
    for i in st["ids"]:
        url = (BASE + f"/submissions/{i}?updateMask.fieldPaths=status&updateMask.fieldPaths=publishedAt")
        call(url, {"fields": {"status": {"stringValue": "published"}, "publishedAt": {"stringValue": st["at"]}}}, "PATCH")
    print(f"marked {len(st['ids'])} live")


if __name__ == "__main__":
    {"add": add, "mark": mark}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
