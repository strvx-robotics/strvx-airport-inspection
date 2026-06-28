import re
from difflib import SequenceMatcher

# jsdiff diffWords tokenizes on word boundaries, keeping whitespace runs as tokens.
_TOKEN = re.compile(r"\s+|\w+|[^\s\w]+")


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text)


def diff_words(a: str, b: str) -> list[dict]:
    """Word-level diff returning ordered {value, added, removed} parts.
    Removed (a-only) parts precede added (b-only) parts within a change, matching jsdiff."""
    ta, tb = _tokens(a), _tokens(b)
    parts: list[dict] = []
    for op, i1, i2, j1, j2 in SequenceMatcher(a=ta, b=tb, autojunk=False).get_opcodes():
        if op == "equal":
            parts.append({"value": "".join(ta[i1:i2]), "added": False, "removed": False})
        elif op == "delete":
            parts.append({"value": "".join(ta[i1:i2]), "added": False, "removed": True})
        elif op == "insert":
            parts.append({"value": "".join(tb[j1:j2]), "added": True, "removed": False})
        elif op == "replace":
            parts.append({"value": "".join(ta[i1:i2]), "added": False, "removed": True})
            parts.append({"value": "".join(tb[j1:j2]), "added": True, "removed": False})
    return parts


def compute_draft_edit_distance(ai: str, final: str) -> int:
    return sum(len(p["value"]) for p in diff_words(ai, final) if p["added"] or p["removed"])
