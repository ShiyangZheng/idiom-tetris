#!/usr/bin/env python3
"""
build_pool.py — Re-embed the idiom pool into index.html.

Run this whenever you change `idioms_compact.json` so the game
keeps working from `file://` (no static server needed). It reads
the JSON file next to it and writes the pool as a
`<script>window.__IDIOMS_POOL__ = ...</script>` block back into
index.html, in place.

Usage:
    cd .workbuddy/idiom_game/idiom_tetris
    python3 build_pool.py

The script is idempotent: running it twice yields the same HTML.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HTML = HERE / "index.html"
JSON_PATH = HERE / "idioms_compact.json"

# Match the EMBEDDED IDIOM POOL comment block. The block always
# ends with the line `============================================================ -->`
# (60 `=` chars) followed by a newline. We can't use `[\s\S]*?` to
# match up to that line directly because the comment *body* may
# contain `-->` (e.g. an English example sentence like "A --> B").
# Instead we anchor on the literal closing line and walk back.
POOL_COMMENT_END = "============================================================ -->\n"


def main() -> int:
    if not JSON_PATH.exists():
        print(f"error: {JSON_PATH} not found", file=sys.stderr)
        return 1
    if not HTML.exists():
        print(f"error: {HTML} not found", file=sys.stderr)
        return 1

    pool = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    n_verbs = len(pool.get("verbs", []))
    n_dets = len(pool.get("dets", []))
    n_nouns = len(pool.get("nouns", []))
    n_lookup = len(pool.get("lookup", {}))
    print(
        f"loaded: {n_verbs} verbs, {n_dets} dets, {n_nouns} nouns, "
        f"{n_lookup} idioms"
    )

    # Match the style of the original hand-written pool: spaces after
    # `:` and `,` to keep diffs from build runs tiny.
    pool_js = json.dumps(pool, ensure_ascii=False, separators=(", ", ": "))
    pool_script = f"<script>window.__IDIOMS_POOL__ = {pool_js};</script>"

    html = HTML.read_text(encoding="utf-8")
    # Find the comment-start marker.
    head_marker = "<!-- ============================================================\n     EMBEDDED IDIOM POOL"
    head_idx = html.find(head_marker)
    if head_idx < 0:
        print(
            "error: could not find the EMBEDDED IDIOM POOL comment header.",
            file=sys.stderr,
        )
        return 1
    comment_end_idx = html.find(POOL_COMMENT_END, head_idx)
    if comment_end_idx < 0:
        print(
            "error: could not find the closing line of the comment.",
            file=sys.stderr,
        )
        return 1
    after_comment = comment_end_idx + len(POOL_COMMENT_END)

    # The <script> tag should start immediately after the comment.
    if not html[after_comment:].startswith("<script>window.__IDIOMS_POOL__"):
        print(
            "error: expected <script> immediately after the comment.",
            file=sys.stderr,
        )
        return 1
    script_end = html.find("</script>", after_comment)
    if script_end < 0:
        print("error: pool script tag is unterminated.", file=sys.stderr)
        return 1
    script_end += len("</script>")

    new_html = html[:after_comment] + pool_script + html[script_end:]

    # Sanity check: the assignment expression `__IDIOMS_POOL__ = {...}`
    # must appear exactly once (the variable name itself legitimately
    # appears in comments and in source code that consumes the pool).
    if new_html.count("window.__IDIOMS_POOL__ =") != 1:
        print(
            "error: refactor produced zero or multiple pool embeds. "
            "Aborting to avoid corrupting index.html.",
            file=sys.stderr,
        )
        return 1

    HTML.write_text(new_html, encoding="utf-8")
    print(f"wrote: {HTML} ({len(new_html):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
