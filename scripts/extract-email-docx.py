"""Generate the review catalog from the supplied Word document."""
from __future__ import annotations

import html
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

SOURCE = Path("docs/superpowers/plans/02BFMclienttemplatesREVIEW160926v2.docx")
OUTPUT = Path("server/services/email-template-catalog.ts")
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
HEADING = re.compile(r"^(E\d+|M\d+(?:-[A-Za-z]+)?|F\d+(?:-[A-Za-z]+)?|S\d+|N\d+|U\d+|D\d+|C\d+|CIM\d+|X\d+)\.\s+(.+)$")
TOKEN = re.compile(r"\{\{([^{}]+)\}\}")
VARIABLE_OVERRIDES = {
    "Personalise this to respond to the client's enquiry": {
        "key": "personalised_response",
        "label": "Personalised response",
    },
}


def slug(label: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return value[:80] or "value"


def variable_metadata(label: str) -> dict[str, str]:
    decoded_label = html.unescape(label)
    return VARIABLE_OVERRIDES.get(decoded_label, {
        "key": slug(decoded_label),
        "label": decoded_label,
    })


def main() -> None:
    with zipfile.ZipFile(SOURCE) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
        relationships = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    links = {rel.attrib["Id"]: rel.attrib.get("Target", "") for rel in relationships.findall(f"{PKG}Relationship")}
    paragraphs = document.findall(f".//{W}p")

    def plain(paragraph: ET.Element) -> str:
        return "".join(element.text or "" for element in paragraph.findall(f".//{W}t")).strip()

    def formatted(paragraph: ET.Element) -> str:
        parts: list[str] = []
        for child in paragraph:
            if child.tag == f"{W}hyperlink":
                label = "".join(t.text or "" for t in child.findall(f".//{W}t"))
                href = links.get(child.attrib.get(f"{R}id", ""), "")
                parts.append(f'<a href="{html.escape(href, quote=True)}">{html.escape(label)}</a>' if href else html.escape(label))
            elif child.tag == f"{W}r":
                parts.append(html.escape("".join(t.text or "" for t in child.findall(f".//{W}t"))))
        return "".join(parts)

    start = next(i for i, p in enumerate(paragraphs) if plain(p).startswith("E1.  Mediation enquiry"))
    end = next(i for i in range(start, len(paragraphs)) if plain(paragraphs[i]).startswith("Appendix. Link register"))
    headings = [(i, HEADING.match(plain(paragraphs[i]))) for i in range(start, end)]
    headings = [(i, match) for i, match in headings if match]
    catalog = []
    for position, (index, match) in enumerate(headings):
        section = paragraphs[index + 1:headings[position + 1][0] if position + 1 < len(headings) else end]
        lines = [plain(p) for p in section]
        marker = next((i for i, line in enumerate(lines) if "copy from inside this box" in line.lower()), -1)
        if marker < 0:
            print(f"Missing body marker: {match.group(1)}", file=sys.stderr)
            continue
        subject = next((line.split(":", 1)[1].strip() for line in lines[:marker] if line.lower().startswith("subject:")), match.group(2))
        if subject.lower().startswith("subject:"):
            subject = subject.split(":", 1)[1].strip()
        guidance = next((line.split(":", 1)[1].strip() for line in lines[:marker] if line.lower().startswith("when to use it:")), "")
        body_lines = [formatted(p).strip() for p in section[marker + 1:]]
        if match.group(1) == "X3":
            email_start = next((i for i, line in enumerate(body_lines) if line.strip() == "The email"), -1)
            if email_start >= 0:
                guidance += " Before sending: phone the client first, update the tracker, and ask about urgency."
                body_lines = body_lines[email_start + 1:]
        while body_lines and not body_lines[-1]:
            body_lines.pop()
        labels = list(dict.fromkeys(html.unescape(label) for line in [subject, *body_lines] for label in TOKEN.findall(line)))
        variables = [variable_metadata(label) for label in labels]
        for label, variable in zip(labels, variables):
            replacement = "{{" + variable["key"] + "}}"
            subject = subject.replace("{{" + label + "}}", replacement).replace("{{" + html.escape(label) + "}}", replacement)
            body_lines = [line.replace("{{" + html.escape(label) + "}}", replacement).replace("{{" + label + "}}", replacement) for line in body_lines]
        body = "".join(f"<p>{line or '<br>'}</p>" for line in body_lines)
        code = match.group(1)
        catalog.append({"code": code, "name": match.group(2), "subject": subject, "bodyHtml": body, "guidance": guidance, "kind": "calendar" if code.startswith(("M4-", "F4-")) else "manual", "status": "draft", "variables": variables})
    if len(catalog) == 65 and not any(item["code"] == "N2" for item in catalog):
        catalog.append({"code": "N2", "name": "Recording emerging options", "subject": "", "bodyHtml": "<p>Source wording is missing from the review document. Replace this note before publishing.</p>", "guidance": "Incomplete source: the DOCX index lists N2, but has no N2 subject or body. Sent between sessions where the mediator has captured options that are still being explored. Not an agreement.", "kind": "manual", "status": "draft", "variables": []})
    if len(catalog) != 66:
        raise RuntimeError(f"Expected 66 templates, found {len(catalog)}")
    appendix = [plain(p) for p in paragraphs[end:]]
    link_catalog = []
    for i, line in enumerate(appendix):
        if re.fullmatch(r"(?:LINK_[A-Z_]+|ZOOM_[A-Z]+)", line) and i + 2 < len(appendix):
            link_catalog.append({"key": line.lower(), "label": appendix[i + 1], "url": appendix[i + 2]})
    all_bodies = "".join(item["bodyHtml"] for item in catalog)
    for link in link_catalog:
        if link["key"].startswith("zoom_"):
            match = re.search(r'href="(' + re.escape(link["url"]) + r'\?[^\"]+)"', all_bodies)
            if match:
                link["url"] = html.unescape(match.group(1))
    for item in catalog:
        for link in link_catalog:
            url = link["url"]
            if url.startswith("https://"):
                item["bodyHtml"] = item["bodyHtml"].replace(f'href="{html.escape(url, quote=True)}"', f'href="{{{{{link["key"]}}}}}"')
                if link["key"] == "link_fees":
                    item["bodyHtml"] = item["bodyHtml"].replace('href="https://www.brighterfuturemediation.co.uk/fees"', 'href="{{link_fees}}"')
    OUTPUT.write_text("// Generated by scripts/extract-email-docx.py from the review DOCX.\n" +
        "export const docxTemplateCatalog: Array<{code: string; name: string; subject: string; bodyHtml: string; guidance: string; kind: 'manual' | 'calendar'; status: 'draft'; variables: Array<{key: string; label: string}>}> = " +
        json.dumps(catalog, ensure_ascii=False, indent=2) + ";\n" +
        "export const docxLinkCatalog: Array<{key: string; label: string; url: string}> = " + json.dumps(link_catalog, ensure_ascii=False, indent=2) + ";\n")
    print(f"Generated {len(catalog)} templates and {len(link_catalog)} links in {OUTPUT}")


if __name__ == "__main__":
    main()
