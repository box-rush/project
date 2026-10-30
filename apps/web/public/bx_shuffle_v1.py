#!/usr/bin/env python3
"""
BOXラッシュ bx-shuffle-v1 verifier (first release: card-number random, no external beacon).
Usage:  python3 bx_shuffle_v1.py record.json
`record.json` is the public opening record (download it from the verification page).
Only the Python standard library is used. Spec: product doc §10.4.
"""
import hashlib, json, sys

def H(x: str) -> str:
    return hashlib.sha256(x.encode("utf-8")).hexdigest()

def shuffle(final: str, units: list) -> list:
    arr = list(range(len(units)))
    for i in range(len(units) - 1, 0, -1):
        j = int(H(f"{final}:{i}")[:8], 16) % (i + 1)
        arr[i], arr[j] = arr[j], arr[i]
    return [units[k] for k in arr]

def main(path: str) -> int:
    rec = json.load(open(path, encoding="utf-8"))
    seed = rec["draw"]["serverSeed"]
    text = rec["participants"]["text"]
    beacon = rec["draw"].get("beacon") or ""
    checklist = [c["number"] for c in rec["snapshot"]["checklist"]]
    ok = True
    commit = H(seed)
    print("commit       ", "OK" if commit == rec["commitment"]["seedCommit"] else "MISMATCH", commit)
    ok &= commit == rec["commitment"]["seedCommit"]
    ph = H(text)
    print("participants ", "OK" if ph == rec["participants"]["hash"] else "MISMATCH", ph)
    ok &= ph == rec["participants"]["hash"]
    final = H(f"{seed}|{ph}|{beacon}")
    print("final        ", "OK" if final == rec["draw"]["final"] else "MISMATCH", final)
    ok &= final == rec["draw"]["final"]
    lines = text.split("\n")
    shuffled = shuffle(final, checklist)
    assignment = [[] for _ in lines]
    for k, num in enumerate(shuffled):
        assignment[k % len(lines)].append(num)
    published = {s["slot"]: sorted(s["numbers"]) for s in rec["draw"]["slots"]}
    for i, nums in enumerate(assignment):
        same = sorted(nums) == published.get(i + 1)
        ok &= same
        print(f"slot #{i+1:02d} {lines[i]:<16}", "OK" if same else "MISMATCH", " ".join(sorted(nums)))
    print("RESULT:", "ALL MATCH" if ok else "MISMATCH")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
