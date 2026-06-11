#!/usr/bin/env python3
"""Extract unique user prompts from Cursor agent transcripts."""
import json
import re
import glob
import os

TRANSCRIPT_GLOB = os.path.expanduser(
    "~/.cursor/projects/Users-kushagrakaushik-SpatialUI/agent-transcripts/*/*.jsonl"
)

def extract_queries(text):
    for m in re.finditer(r"<user_query>\s*(.*?)\s*</user_query>", text, re.DOTALL):
        q = m.group(1).strip()
        if len(q) < 80:
            continue
        if "cursor_rules_context" in text[:400]:
            continue
        yield q

def main():
    seen = set()
    out = []
    for path in sorted(glob.glob(TRANSCRIPT_GLOB)):
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if o.get("role") != "user":
                    continue
                for c in o.get("message", {}).get("content", []):
                    if c.get("type") != "text":
                        continue
                    t = c.get("text", "")
                    for q in extract_queries(t):
                        key = q[:300]
                        if key in seen:
                            continue
                        seen.add(key)
                        out.append(q)
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
