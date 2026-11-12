"""
Email alerts for the Signals page: one GitHub issue per active idea to investigate (GitHub emails the repository owner
when an issue opens and when it gets a comment). Run by update.yml after the data refresh, with GH_TOKEN set.

- An idea that is active and not yet open as an issue -> open one (label "signal-idea").
- An open "signal-idea" issue whose idea is no longer active -> close it with a comment.
Idempotent: titles are stable, so re-running on the same data changes nothing. If signals.json is missing or broken,
nothing is opened or closed.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SITE = "https://cl272.github.io/strategist-dashboard/#tab=signals"
LABEL = "signal-idea"


def gh(*args: str) -> str:
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        print("gh failed:", " ".join(args[:3]), r.stderr.strip()[:200])
    return r.stdout


def title_of(g: dict) -> str:
    n = g["target_name"]
    if g["target"].startswith("R_"):
        w = "outperformance continuing" if g["dir"] > 0 else "underperformance continuing"
    elif g["kind"] == "chg":
        w = "likely to rise" if g["dir"] > 0 else "likely to fall"
    else:
        w = "positive" if g["dir"] > 0 else "caution"
    return f"Idea to investigate: {n} ({w})"


def move(kind: str, v) -> str:
    if v is None:
        return "–"
    return f"{v:+.1f}%" if kind == "ret" else f"{v:+.2f} pts"


def body_of(g: dict, sigs: dict) -> str:
    lines = [f"**{title_of(g).split(': ', 1)[1]}** — {len(g['signals'])} signal(s) for"
             + (f", {len(g['against'])} against" if g["against"] else ", none against") + ".", ""]
    for sid in g["signals"]:
        x = sigs.get(sid)
        if not x:
            continue
        h = x.get("best_h")
        st = (x.get("stats") or {}).get(str(h)) if h else None
        lines.append(f"- **{x['name']}** ({x['tier']}"
                     + (f"; graded down from {x['tier_before'].lower()}: {', '.join(x['downgrades'])}" if x.get("downgrades") else "") + ")")
        lines.append(f"  - Rule: {x['rule']}. On since {x.get('since') or '–'}.")
        if st:
            lines.append(f"  - Record: {st['n']} times since {(x.get('history_from') or '')[:4]}: median {move(x['kind'], st['med'])} over {h} months, "
                         f"up {st['hit']:.0f}% of the time; in all months {move(x['kind'], st['base_med'])}, up {st['base_hit']:.0f}%.")
        w = x.get("wf") or {}
        if w.get("verdict") == "held up":
            lines.append(f"  - Out of sample (after {w['split'][:4]}): held up ({w['n_oos']} events, up {w['hit_oos']:.0f}% vs {w['base_hit_oos']:.0f}% normally).")
        elif w.get("verdict"):
            lines.append(f"  - Out of sample: {w['verdict']}.")
        if x.get("moved") is not None and st:
            lines.append(f"  - Since it fired: {move(x['kind'], x['moved'])} (typical over {h} months: {move(x['kind'], st['med'])}).")
    if g.get("catalysts"):
        lines += ["", "Next events: " + "; ".join(f"{c['d']} {c['region']} {c['name']}" for c in g["catalysts"])]
    lines += ["", f"Details and charts: {SITE}", "",
              "_Research prompt from fixed rules on public data, not a recommendation. This issue closes itself when the signal switches off._"]
    return "\n".join(lines)


def main() -> int:
    p = Path("docs/data/signals.json")
    try:
        d = json.loads(p.read_text())
        ideas = [g for g in d["ideas"] if g.get("net", 0) > 0]
        sigs = {x["id"]: x for x in d["signals"]}
    except Exception as e:
        print(f"signals.json not usable ({type(e).__name__}); no alerts changed")
        return 0
    gh("label", "create", LABEL, "--color", "1F4FB2", "--description", "Idea to investigate from the Signals page", "--force")
    try:
        open_issues = json.loads(gh("issue", "list", "--label", LABEL, "--state", "open", "--limit", "100", "--json", "number,title") or "[]")
    except Exception:
        print("could not list issues; no alerts changed")
        return 0
    have = {i["title"]: i["number"] for i in open_issues}
    want = {title_of(g): g for g in ideas}
    for t, g in want.items():
        if t not in have:
            gh("issue", "create", "--title", t, "--label", LABEL, "--body", body_of(g, sigs))
            print("opened:", t)
    for t, n in have.items():
        if t not in want:
            gh("issue", "close", str(n), "--comment", "This idea is no longer active: its signals switched off or passed their horizon.")
            print("closed:", t)
    print(f"{len(want)} active idea(s); {len(have)} were open before")
    return 0


if __name__ == "__main__":
    sys.exit(main())
