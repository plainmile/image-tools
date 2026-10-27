"""Check the built static site, not just source templates."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET
import json

DIST = Path("dist")
ORIGIN = "https://image.plainmile.com"
TOOLS = [
    "resize-image", "compress-image-to-size", "signature-resizer",
    "bulk-image-resizer", "passport-photo-print", "redact-image",
]
ROUTES = ["/", "/privacy/"] + [f"/{x}/" for x in TOOLS]
ROUTES += ["/zh" + route for route in ROUTES]
ROUTES = sorted(ROUTES)

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.title, self.description, self.canonical = [], "", "", ""
        self.h1, self.hreflangs, self.robots, self.jsonld = 0, {}, "", []
        self._in_title, self._in_ld, self._ld_buffer = False, False, ""
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "h1":
            self.h1 += 1
        if tag == "meta" and attrs.get("name") == "description":
            self.description = attrs.get("content", "")
        if tag == "meta" and attrs.get("name") == "robots":
            self.robots = attrs.get("content", "")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical = attrs.get("href", "")
        if tag == "link" and attrs.get("rel") == "alternate":
            self.hreflangs[attrs.get("hreflang")] = attrs.get("href")
        if tag == "script" and attrs.get("type") == "application/ld+json":
            self._in_ld, self._ld_buffer = True, ""
    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_ld:
            self._ld_buffer += data
    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag == "script" and self._in_ld:
            self.jsonld.append(json.loads(self._ld_buffer))
            self._in_ld = False

titles = {}
for route in ROUTES:
    path = DIST / route.lstrip("/") / "index.html"
    assert path.exists(), f"missing page: {path}"
    doc = Page()
    doc.feed(path.read_text(encoding="utf-8"))
    assert doc.title and len(doc.title) <= 95, (route, doc.title)
    assert doc.title not in titles, f"duplicate title: {route} and {titles[doc.title]}"
    titles[doc.title] = route
    assert doc.description and len(doc.description) >= (18 if route.startswith('/zh/') else 30), (route, doc.description)
    assert doc.h1 == 1, f"expected one H1 for {route}: {doc.h1}"
    assert doc.canonical == ORIGIN + route, (route, doc.canonical)
    counterpart = route[3:] if route.startswith("/zh/") else "/zh" + route
    english = counterpart if route.startswith("/zh/") else route
    chinese = route if route.startswith("/zh/") else counterpart
    assert doc.hreflangs == {
        "en": ORIGIN + english,
        "zh-CN": ORIGIN + chinese,
        "x-default": ORIGIN + english,
    }, (route, doc.hreflangs)
    assert "noindex" not in doc.robots.lower(), (route, doc.robots)
    assert len(doc.jsonld) >= 1, f"missing JSON-LD on {route}"
    expected = "WebSite" if route in ("/", "/zh/") else "WebPage" if route.endswith("/privacy/") else "WebApplication"
    assert any(item.get("@type") == expected for item in doc.jsonld), (route, expected, doc.jsonld)
    for item in doc.jsonld:
        assert item.get("url") == ORIGIN + route, (route, item)
        if expected == "WebApplication":
            assert item.get("offers", {}).get("price") == "0", (route, item)
            assert item.get("inLanguage") == ("zh-CN" if route.startswith("/zh/") else "en"), (route, item)
            assert item.get("isAccessibleForFree") is True, (route, item)

not_found = Page()
not_found.feed((DIST / "404.html").read_text(encoding="utf-8"))
assert "noindex" in not_found.robots.lower()
assert not not_found.canonical

index_path = DIST / "sitemap-index.xml"
assert index_path.exists()
root = ET.parse(index_path).getroot()
child_urls = [entry.text for entry in root.findall(".//{*}loc")]
assert child_urls, "sitemap index is empty"
listed = set()
for address in child_urls:
    u = urlparse(address)
    assert (u.scheme, u.netloc) == ("https", "image.plainmile.com")
    xml_path = DIST / u.path.lstrip("/")
    assert xml_path.exists(), f"child sitemap missing: {xml_path}"
    for node in ET.parse(xml_path).getroot().findall(".//{*}loc"):
        listed.add(node.text)
assert set(ORIGIN + route for route in ROUTES).issubset(listed), sorted(set(ORIGIN + route for route in ROUTES) - listed)
assert ORIGIN + "/404/" not in listed
robots = (DIST / "robots.txt").read_text()
assert "Sitemap: https://image.plainmile.com/sitemap-index.xml" in robots
print(f"SEO PASS: {len(ROUTES)} routes, canonical/hreflang, unique titles, 404 noindex, sitemap entries")
