#!/usr/bin/env python3
"""Static builder for the Unstation for Android help site. No Jekyll.

Renders each markdown page into one small styled HTML shell, rewrites the
between-page `.md` links to `.html`, pulls in the app screenshots, and writes
flat files into `_site/`. Output uses only relative links, so it works unchanged
at a project path or a custom domain.

Preview locally:
    pip install markdown
    python3 docs/build.py
    open docs/_site/index.html
"""

import re
import shutil
from pathlib import Path

import markdown

HERE = Path(__file__).parent
REPO = HERE.parent
OUT = HERE / "_site"

# The site, in nav order. First entry is the home page.
# (source markdown, output file, nav label, meta description)
PAGES = [
    ("index.md", "index.html", "Home",
     "Watch live streams and go live from your phone, straight to your friends, with no account."),
    ("watching.md", "watching.html", "Watch",
     "How to find a stream, what the screens mean, and the playback controls."),
    ("going-live.md", "going-live.html", "Go live",
     "How to broadcast from your phone camera, share it, and keep it running."),
    ("best-experience.md", "best-experience.html", "Best experience",
     "Simple tips for the smoothest streaming and watching."),
    ("help.md", "help.html", "Help",
     "Answers to common problems: connecting, sound, video, battery, and sign-in."),
]

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="stylesheet" href="assets/css/docs.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap head-inner">
<a class="wordmark" href="index.html">unstation</a>
<nav class="site-nav" aria-label="Help">
{nav}
</nav>
<a class="gh" href="https://github.com/lovelaced/unstation-android" rel="noopener">GitHub</a>
</div></header>
<main id="main" class="wrap doc">
{content}
</main>
<footer class="site-foot"><div class="wrap">
<p>Experimental, unaudited, and community-run. Free software under the AGPL-3.0.</p>
<p>No servers, no accounts, no one to take it down.</p>
</div></footer>
</body>
</html>
"""

FRONT_MATTER = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)
MD_LINK = re.compile(r"\]\((?!https?://)([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)")


def render(md_text):
    md_text = FRONT_MATTER.sub("", md_text)
    md_text = MD_LINK.sub(r"](\1.html\2)", md_text)     # between-page links
    md_text = md_text.replace("../assets/", "assets/")  # screenshots: repo path -> site path
    # `permalink` adds a small "#" link on each heading so any section can be linked
    # to directly; the CSS reveals it on hover.
    md = markdown.Markdown(
        extensions=["tables", "fenced_code", "toc"],
        extension_configs={"toc": {"permalink": "#"}},
    )
    html = md.convert(md_text)
    html = html.replace("<table>", '<div class="table-scroll"><table>').replace(
        "</table>", "</table></div>")
    return html


def nav_for(current):
    out = []
    for _, href, label, _ in PAGES:
        cur = ' aria-current="page"' if href == current else ""
        out.append(f'<a href="{href}"{cur}>{label}</a>')
    return "\n".join(out)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    shutil.copytree(HERE / "assets", OUT / "assets")                       # css
    shutil.copytree(REPO / "assets" / "screenshots", OUT / "assets" / "screenshots")  # app shots

    for src, href, label, desc in PAGES:
        content = render((HERE / src).read_text())
        title = "Unstation for Android" if href == "index.html" else f"{label} · Unstation for Android"
        (OUT / href).write_text(
            TEMPLATE.format(title=title, description=desc, nav=nav_for(href), content=content)
        )
        print("built", href)
    print("done ->", OUT)


if __name__ == "__main__":
    main()
