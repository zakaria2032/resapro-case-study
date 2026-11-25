#!/usr/bin/env python3
"""Contrôle avant publication d'un dépôt Git : confidentialité de TOUT l'historique.

Usage :
    python3 scripts/verif-publication.py                      # toutes les références (branches, tags)
    python3 scripts/verif-publication.py --refs main --tags   # uniquement ce qui sera poussé
    python3 scripts/verif-publication.py --allow-email moi@exemple.fr

Vérifie, dans chaque commit, tag et fichier jamais versionné :
  1. identités (auteurs, committers, taggers) : uniquement des adresses autorisées ;
  2. messages de commit et de tag : aucun lien de session privée ; mentions Co-Authored-By conservées ;
  3. contenu des fichiers : aucun chemin local (profil Windows, /home/…, /Users/…), aucune adresse e-mail
     non autorisée, aucune clé d'apparence réelle ;
  4. fichiers interdits jamais versionnés (.env, clés, bundles, node_modules) ;
  5. gitleaks sur l'historique (si installé).
Bibliothèque standard uniquement. Code de sortie : 0 = rien trouvé, 1 = à corriger, 2 = erreur.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SELF = "scripts/verif-publication.py"  # ce fichier contient les motifs recherchés : exclu du scan de contenu

DEFAULT_EMAILS = {"zakaria2032@users.noreply.github.com", "noreply@anthropic.com", "noreply@github.com"}
ALLOWED_EMAIL_DOMAINS = ("example.test", "example.com", "example.org", "users.noreply.github.com")

SESSION = re.compile(r"claude\.ai/code/session|Claude-Session|session_[A-Za-z0-9]{16,}")
CONTENT_PATTERNS = {
    "chemin Windows (profil)": re.compile(r"[A-Za-z]:(\\\\|\\|/)(Users|Documents and Settings)(\\\\|\\|/)", re.I),
    "chemin macOS (profil)": re.compile(r"/Users/[A-Za-z0-9._-]+/"),
    "chemin Linux (profil)": re.compile(r"/home/[A-Za-z0-9._-]+/|/root/"),
    "dossier temporaire HOCS": re.compile(r"/tmp/hocs-|\\\\Temp\\\\hocs-|\\Temp\\hocs-"),
    "lien de session privée": SESSION,
    "clé Stripe live": re.compile(r"\b(sk|rk|pk)_live_[A-Za-z0-9]{10,}"),
    "clé Stripe test réelle": re.compile(r"\bsk_test_[A-Za-z0-9]{24,}"),
    "secret webhook réel": re.compile(r"\bwhsec_[A-Za-z0-9]{24,}"),
    "JWT": re.compile(r"\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\."),
}
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
FORBIDDEN_FILES = re.compile(r"(^|/)(\.env(\.local|\.production)?|.*\.pem|.*\.key|.*\.p12|.*\.bundle|id_rsa.*)$|(^|/)node_modules/|(^|/)supabase/\.temp/")


def git(*args: str, data: bytes | None = None) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, input=data, capture_output=True, check=True).stdout


def main() -> int:
    # Console Windows (cp1252) : forcer l'UTF-8 pour afficher les accents et les flèches.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refs", nargs="*", help="références à contrôler (défaut : --all)")
    ap.add_argument("--tags", action="store_true", help="ajouter tous les tags aux --refs")
    ap.add_argument("--allow-email", action="append", default=[], help="adresse supplémentaire autorisée")
    args = ap.parse_args()

    allowed = DEFAULT_EMAILS | {e.lower() for e in args.allow_email}
    refs = list(args.refs or [])
    if args.tags:
        refs += git("tag").decode().split()
    rev = refs if refs else ["--all"]
    findings: dict[str, list[str]] = {}

    def add(check: str, msg: str) -> None:
        findings.setdefault(check, [])
        if len(findings[check]) < 15:
            findings[check].append(msg)

    def email_ok(e: str) -> bool:
        e = e.lower()
        return e in allowed or e.endswith(ALLOWED_EMAIL_DOMAINS)

    # 1 + 2. Commits : identités et messages
    log = git("log", *rev, "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e").decode("utf-8", "replace")
    commits = [c for c in log.split("\x1e") if c.strip()]
    identities, coauthored = set(), 0
    for c in commits:
        sha, an, ae, cn, ce, body = c.strip("\n").split("\x1f", 5)
        identities |= {f"{an} <{ae}>", f"{cn} <{ce}>"}
        for e in (ae, ce):
            if not email_ok(e):
                add("1. identités", f"{sha[:10]} : adresse non autorisée {e}")
        if SESSION.search(body):
            add("2. messages", f"{sha[:10]} : lien ou identifiant de session dans le message")
        for e in EMAIL.findall(body):
            if not email_ok(e):
                add("2. messages", f"{sha[:10]} : adresse {e} dans le message")
        coauthored += bool(re.search(r"Co-Authored-By: Claude", body))
    for t in git("for-each-ref", "refs/tags", "--format=%(refname:short)%1f%(taggeremail)%1f%(contents)%1e").decode().split("\x1e"):
        if not t.strip():
            continue
        name, temail, contents = t.strip("\n").split("\x1f", 2)
        temail = temail.strip("<>")
        if temail and not email_ok(temail):
            add("1. identités", f"tag {name} : tagger {temail}")
        if SESSION.search(contents):
            add("2. messages", f"tag {name} : lien de session dans le message")
    if git("notes", "list").strip():
        add("2. messages", "notes Git présentes (git notes list)")

    # 3 + 4. Contenu de tous les fichiers jamais versionnés dans ces références
    objects = git("rev-list", "--objects", *rev).decode("utf-8", "replace").splitlines()
    paths: dict[str, str] = {}
    for line in objects:
        sha, _, path = line.partition(" ")
        if path:
            paths.setdefault(sha, path)
            if FORBIDDEN_FILES.search(path):
                add("4. fichiers interdits", f"{path}")
    batch = git("cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)", data="\n".join(paths).encode()).decode().splitlines()
    blobs = [b.split()[0] for b in batch if b.split()[1] == "blob" and paths[b.split()[0]] != SELF]
    for sha in blobs:
        text = git("cat-file", "blob", sha).decode("utf-8", "replace")
        path = paths[sha]
        for label, rx in CONTENT_PATTERNS.items():
            m = rx.search(text)
            if m:
                add("3. contenu", f"{path} : {label} → « {text[max(0, m.start() - 20):m.end() + 20].strip()} »")
        if not path.endswith("package-lock.json"):
            for e in set(EMAIL.findall(text)):
                if not email_ok(e):
                    add("3. contenu", f"{path} : adresse e-mail {e}")

    # 5. gitleaks
    gl = shutil.which("gitleaks")
    if gl:
        p = subprocess.run([gl, "git", str(ROOT), "--no-banner", "--no-color", "--redact", "--exit-code", "1"], capture_output=True, text=True)
        if p.returncode != 0:
            add("5. gitleaks", "fuite(s) détectée(s) : lancer gitleaks git . pour le détail")
    else:
        add("5. gitleaks", "gitleaks introuvable : contrôle non exécuté")

    # Rapport
    print(f"Références : {' '.join(rev)} — {len(commits)} commits, {len(blobs)} fichiers (toutes versions)")
    print("Identités présentes :", "; ".join(sorted(identities)))
    print(f"Commits mentionnant Co-Authored-By: Claude : {coauthored}")
    remotes = git("remote", "-v").decode().strip()
    print("Dépôts distants :", remotes or "aucun")
    print()
    for check in ["1. identités", "2. messages", "3. contenu", "4. fichiers interdits", "5. gitleaks"]:
        items = findings.get(check, [])
        print(f"{'PASS' if not items else 'FAIL'}  {check}")
        for i in items:
            print(f"      - {i}")
    ok = not findings
    print("\nRÉSULTAT :", "rien à corriger" if ok else "à corriger avant publication")
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"Erreur d'exécution : {e!r}", file=sys.stderr)
        sys.exit(2)
