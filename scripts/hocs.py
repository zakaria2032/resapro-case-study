#!/usr/bin/env python3
"""HOCS — couche 1 : contrôles déterministes et rapport Go/No-Go.

Usage :
    python3 scripts/hocs.py                    # contrôle HEAD
    python3 scripts/hocs.py --ref v1-initial   # contrôle une version précise

Principe : le code de la version ciblée est extrait dans un dossier temporaire (git worktree),
puis on lui applique la MÊME batterie de tests (celle de ce dépôt). Chaque contrôle donne
PASS / FAIL avec une preuve. Verdict GO seulement si tous les contrôles bloquants sont PASS.

Dépendances : Python 3 (bibliothèque standard), Node/npm (node_modules installé), Postgres local,
gitleaks. Code de sortie : 0 = GO, 1 = NO-GO, 2 = erreur d'exécution.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# id, intitulé, problème du diagnostic, source de la preuve
CONTROLS = [
    ("C01", "Un client ne voit que ses propres réservations (test multi-comptes)", "#1", "tests/rls.test.ts"),
    ("C02", "RLS active sur toutes les tables, aucune règle « using (true) » sur les tables sensibles", "#1", "tests/rls.test.ts"),
    ("C03", "Impossible de devenir admin soi-même (modification du rôle, inscription)", "#2", "tests/roles.test.ts"),
    ("C04", "Aucune clé service_role dans le code ou le bundle front", "#3", "tests/frontend-secrets.test.ts"),
    ("C05", "Webhook Stripe : signature absente, fausse, altérée ou expirée refusée ; montant ou statut incohérent non confirmé et tracé", "#4", "tests/webhook.test.ts"),
    ("C06", "Webhook Stripe : un événement rejoué est traité une seule fois", "#4", "tests/webhook.test.ts"),
    ("C07", "Montant de l'acompte calculé côté serveur", "#5", "tests/checkout.test.ts"),
    ("C08", "Factures privées (bucket non public, lecture réservée au propriétaire)", "#6", "tests/storage.test.ts"),
    ("C09", "Fonction admin : 401 sans compte, 403 si non admin", "#7", "tests/admin.test.ts"),
    ("C10", "L'annulation libère le créneau", "#8", "tests/cancel.test.ts"),
    ("C11", "Erreurs gérées (réponses 400/404/409 explicites, aucun plantage)", "#8", "tests/checkout.test.ts, tests/cancel.test.ts"),
    ("C12", "Tests automatisés présents dans la version et README complet", "#9", "arborescence git de la version"),
    ("C13", "Build OK (typage TypeScript + build Vite)", "—", "build.log"),
    ("C14", "Lint OK (ESLint)", "—", "lint.log"),
    ("C15", "Scan de secrets : 0 fuite (fichiers + historique git)", "—", "gitleaks-*.json"),
    ("C16", "Parcours complet inscription → réservation → paiement → confirmation (non-régression)", "—", "tests/parcours.test.ts"),
    ("C17", "Gestion : paiement abandonné → créneau remis en vente ; chiffre d'affaires admin hors annulations (ajout v2.1)", "v2.1", "tests/gestion.test.ts"),
]

OUT_OF_SCOPE = [
    "Vrai Supabase : HOCS tourne sur PostgreSQL 16 avec une émulation des schémas auth et storage. L'exécution sur un vrai Supabase local (CLI + Docker : migrations, Auth, Storage, Edge Functions) est vérifiée séparément : `qa/verification-supabase-local.md`.",
    "Edge Functions : logique testée sous Node ; sous Deno, `deno check` et un test de fumée (tests/deno/smoke.ts, hors HOCS).",
    "Appels réels à l'API Stripe (mode test) : non exécutés ; faux client dans les tests, Stripe simulé (webhooks signés) pour la vérification manuelle.",
    "Interface web : hors HOCS (build, typage et lint uniquement) ; parcours vérifié dans un navigateur séparément (`npm run test:e2e`).",
    "HOCS est notre contrôle qualité interne : ni une certification indépendante, ni un audit complet, ni un test d'intrusion.",
]


def run(cmd: list[str], cwd: Path, log: Path | None = None, env: dict | None = None, timeout: int = 900) -> subprocess.CompletedProcess:
    # Sous Windows, « npx » est un script npx.cmd : on résout le chemin complet (PATHEXT) avant de l'exécuter.
    exe = shutil.which(cmd[0]) or cmd[0]
    p = subprocess.run([exe, *cmd[1:]], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", env={**os.environ, **(env or {})}, timeout=timeout)
    if log:
        log.write_text(f"$ {' '.join(cmd)}\n(code de sortie : {p.returncode})\n\n{p.stdout}\n{p.stderr}", encoding="utf-8")
    return p


def anonymize(folder: Path, mapping: dict[str, str]) -> None:
    """Remplace les chemins locaux dans toutes les preuves (forme brute et forme échappée JSON, Windows inclus)."""
    pairs = []
    for raw, token in mapping.items():
        pairs += [(raw, token), (raw.replace("\\", "\\\\"), token), (raw.replace("\\", "/"), token)]
    pairs.sort(key=lambda p: -len(p[0]))
    for f in folder.rglob("*"):
        if f.is_file():
            text = f.read_text(encoding="utf-8", errors="replace")
            new = text
            for raw, token in pairs:
                if raw and len(raw) > 3:
                    new = new.replace(raw, token)
            if new != text:
                f.write_text(new, encoding="utf-8")


def git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout.strip()


def link_dir(link: Path, target: Path) -> None:
    """Lien vers un dossier : symlink, ou jonction NTFS sous Windows (pas besoin de droits administrateur)."""
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError:
        if os.name != "nt":
            raise
        import _winapi
        _winapi.CreateJunction(str(target), str(link))


def unlink_dir(link: Path) -> None:
    """Supprime le lien lui-même, jamais le contenu du dossier cible."""
    if link.is_symlink() or (hasattr(os.path, "isjunction") and os.path.isjunction(link)):
        try:
            link.unlink()
        except OSError:
            os.rmdir(link)  # jonction Windows


def tail(text: str, n: int = 12) -> str:
    lines = [l for l in text.strip().splitlines() if l.strip()]
    return "\n".join(lines[-n:])


def main() -> int:
    # Console Windows (cp1252) : forcer l'UTF-8 pour afficher les accents et les flèches.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", default="HEAD", help="version à contrôler (tag, branche, commit). Défaut : HEAD")
    ap.add_argument("--out", help="sous-dossier de qa/preuves/ pour les preuves. Défaut : qa/preuves/<ref>")
    ap.add_argument("--keep", action="store_true", help="conserver le dossier de travail temporaire")
    ap.add_argument("--tests", default="HEAD", help="commit dont on prend la batterie de tests (rejouer un rapport historique). Défaut : HEAD")
    args = ap.parse_args()

    sha = git("rev-parse", f"{args.ref}^{{commit}}")
    runner_sha = git("rev-parse", f"{args.tests}^{{commit}}")
    historical = args.tests != "HEAD"
    if git("status", "--porcelain", "--", "tests", "vitest.config.ts"):
        print("Attention : tests/ modifié localement ; HOCS utilise les tests du commit", runner_sha[:10], file=sys.stderr)
    label = re.sub(r"[^A-Za-z0-9._-]", "_", args.ref)
    base = (ROOT / "qa" / "preuves").resolve()
    out = (ROOT / args.out).resolve() if args.out else base / label
    # Le dossier de sortie est vidé : on n'accepte qu'un sous-dossier de qa/preuves/ (jamais la racine ou ailleurs).
    if base not in out.parents:
        print(f"--out doit être un sous-dossier de qa/preuves/ (reçu : {out})", file=sys.stderr)
        return 2
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    results: dict[str, tuple[str, str]] = {}
    work = Path(tempfile.mkdtemp(prefix=f"hocs-{label}-"))
    wt = work / "src"
    rel = Path(os.path.relpath(out, ROOT)).as_posix()
    print(f"HOCS — version {args.ref} ({sha[:10]}) — preuves : {rel}")

    try:
        git("worktree", "add", "--detach", "--force", str(wt), sha)

        # ---------- C12 : tests et README présents dans la version elle-même (avant superposition) ----------
        files = git("ls-tree", "-r", "--name-only", sha).splitlines()
        tests = [f for f in files if re.match(r"tests/.+\.test\.ts$", f)]
        try:
            readme = git("show", f"{sha}:README.md")
        except subprocess.CalledProcessError:
            readme = ""
        sections = {
            "installation": bool(re.search(r"^#+ .*install", readme, re.I | re.M)),
            "tests": bool(re.search(r"^#+ .*test", readme, re.I | re.M)),
            "avertissement v1": "NE PAS DÉPLOYER" in readme,
            "limites": bool(re.search(r"^#+ .*limite", readme, re.I | re.M)),
        }
        ok12 = len(tests) >= 5 and all(sections.values())
        proof12 = f"{len(tests)} fichier(s) de test dans la version ; README : {len(readme)} caractères, sections " + ", ".join(
            f"{k} {'✓' if v else '✗'}" for k, v in sections.items()
        )
        (out / "static.log").write_text(proof12 + "\n\n" + "\n".join(tests), encoding="utf-8")
        results["C12"] = ("PASS" if ok12 else "FAIL", proof12)

        # ---------- C15 : secrets (fichiers de la version + historique jusqu'à elle) ----------
        gl = shutil.which(os.environ.get("GITLEAKS_BIN", "gitleaks"))
        if not gl:
            results["C15"] = ("FAIL", "gitleaks introuvable : contrôle non exécuté (bloquant)")
        else:
            d = run([gl, "dir", str(wt), "--no-banner", "--no-color", "--redact", "--report-format", "json",
                     "--report-path", str(out / "gitleaks-fichiers.json"), "--exit-code", "1"], ROOT, out / "gitleaks-fichiers.log")
            h = run([gl, "git", str(ROOT), "--no-banner", "--no-color", "--redact", f"--log-opts={sha}", "--report-format", "json",
                     "--report-path", str(out / "gitleaks-historique.json"), "--exit-code", "1"], ROOT, out / "gitleaks-historique.log")
            nf = len(json.loads((out / "gitleaks-fichiers.json").read_text(encoding="utf-8") or "[]"))
            nh = len(json.loads((out / "gitleaks-historique.json").read_text(encoding="utf-8") or "[]"))
            ok = d.returncode == 0 and h.returncode == 0 and nf == 0 and nh == 0
            results["C15"] = ("PASS" if ok else "FAIL", f"gitleaks : {nf} fuite(s) dans les fichiers, {nh} dans l'historique git")

        # ---------- Superposition : la batterie de tests du commit runner_sha appliquée au code de la version ----------
        # Les tests sont extraits du commit (et non du dossier de travail) : le rapport dit exactement quels tests ont tourné.
        shutil.rmtree(wt / "tests", ignore_errors=True)
        archive = subprocess.run(["git", "archive", runner_sha, "tests", "vitest.config.ts"], cwd=ROOT, capture_output=True, check=True)
        # Extraction en Python (et non « tar ») : portable, y compris sous Windows / Git Bash.
        with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tf:
            if hasattr(tarfile, "data_filter"):  # Python ≥ 3.12 (et correctifs 3.10/3.11)
                tf.extractall(wt, filter="data")
            else:
                tf.extractall(wt)
        link_dir(wt / "node_modules", ROOT / "node_modules")

        # ---------- C13 : build ----------
        tsc = run(["npx", "tsc", "--noEmit", "-p", "tsconfig.json"], wt, out / "build-typage.log")
        vb = run(["npx", "vite", "build", "--outDir", str(work / "dist")], wt, out / "build.log",
                 env={"VITE_SUPABASE_URL": "http://127.0.0.1:54321", "VITE_SUPABASE_ANON_KEY": "cle-anon-de-test"})
        results["C13"] = (
            "PASS" if tsc.returncode == 0 and vb.returncode == 0 else "FAIL",
            f"tsc : code {tsc.returncode} ; vite build : code {vb.returncode}"
            + (f"\n```\n{tail(tsc.stdout + tsc.stderr + vb.stderr, 8)}\n```" if tsc.returncode or vb.returncode else ""),
        )

        # ---------- C14 : lint ----------
        lint = run(["npx", "eslint", "."], wt, out / "lint.log")
        results["C14"] = (
            "PASS" if lint.returncode == 0 else "FAIL",
            f"eslint : code {lint.returncode}" + (f"\n```\n{tail(lint.stdout, 8)}\n```" if lint.returncode else ""),
        )

        # ---------- Tests automatisés ----------
        db = f"resapro_hocs_{re.sub(r'[^a-z0-9]', '_', label.lower())}"
        vt = run(["npx", "vitest", "run", "--reporter=json", f"--outputFile={out / 'vitest.json'}"], wt, out / "tests.log",
                 env={"RESAPRO_TEST_DB": db})
        report = json.loads((out / "vitest.json").read_text(encoding="utf-8")) if (out / "vitest.json").exists() else None
        per_control: dict[str, list[tuple[str, str, str]]] = {}
        lines = ["# Résultats détaillés des tests", "", f"Version : `{args.ref}` ({sha[:10]})", ""]
        if report:
            for f in report["testResults"]:
                fname = Path(f["name"]).name
                lines.append(f"## {fname}")
                if not f["assertionResults"] and f.get("message"):
                    lines.append(f"- ✗ Fichier en échec : {f['message'].splitlines()[0]}")
                for a in f["assertionResults"]:
                    msg = (a.get("failureMessages") or [""])[0].splitlines()[0] if a["status"] != "passed" else ""
                    mark = "✓" if a["status"] == "passed" else "✗"
                    lines.append(f"- {mark} {a['title']}" + (f" — `{msg[:160]}`" if msg else ""))
                    for cid in re.findall(r"\[(C\d\d)\]", a["title"])[:1]:
                        per_control.setdefault(cid, []).append((a["status"], a["title"], msg))
                lines.append("")
        else:
            lines.append(f"Rapport JSON absent. Sortie :\n```\n{tail(vt.stdout + vt.stderr, 30)}\n```")
        (out / "tests-detail.md").write_text("\n".join(lines), encoding="utf-8")

        for cid, *_ in CONTROLS:
            if cid in results:
                continue
            tests_c = per_control.get(cid, [])
            if not tests_c:
                if historical:  # contrôle ajouté après la batterie demandée : non évalué
                    results[cid] = ("N/A", f"absent de la batterie de tests `{args.tests}`")
                else:
                    results[cid] = ("FAIL", "aucun test exécuté pour ce contrôle (voir tests.log)")
                continue
            failed = [t for t in tests_c if t[0] != "passed"]
            proof = f"{len(tests_c) - len(failed)}/{len(tests_c)} tests réussis"
            if failed:
                proof += "".join(f"<br>✗ {t[1].replace('[' + cid + '] ', '')} — `{t[2][:120]}`" for t in failed)
            results[cid] = ("FAIL" if failed else "PASS", proof)

        total = sum(len(v) for v in per_control.values())
        passed = sum(1 for v in per_control.values() for t in v if t[0] == "passed")
    finally:
        if not args.keep:
            # Le lien node_modules est retiré AVANT toute suppression récursive : la cible (node_modules du dépôt) est préservée.
            unlink_dir(wt / "node_modules")
            subprocess.run(["git", "worktree", "remove", "--force", str(wt)], cwd=ROOT, capture_output=True)
            shutil.rmtree(work, ignore_errors=True)
        subprocess.run(["git", "worktree", "prune"], cwd=ROOT, capture_output=True)

    # ---------- Anonymisation des preuves : aucun chemin local (dossier du dépôt, temporaire, profil) ----------
    anonymize(out, {str(ROOT): "<depot>", str(work): "<tmp>", str(Path.home()): "~"})

    # ---------- Rapport Go/No-Go ----------
    fails = [c for c, *_ in CONTROLS if results[c][0] == "FAIL"]
    nas = [c for c, *_ in CONTROLS if results[c][0] == "N/A"]
    verdict = "GO" if not fails else "NO-GO"
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    md = [
        f"# Rapport Go/No-Go — RésaPro `{args.ref}`",
        "",
        f"**VERDICT : {verdict}**" + (f" — {len(fails)} contrôle(s) bloquant(s) en échec : {', '.join(fails)}" if fails else (" — tous les contrôles évalués sont PASS" + (f" (non évalués : {', '.join(nas)})" if nas else ""))),
        "",
        "| | |",
        "|---|---|",
        f"| Version contrôlée | `{args.ref}` — commit `{sha}` |",
        f"| Batterie de tests | `{args.tests}` — commit `{runner_sha[:10]}` (la même batterie s'applique à toutes les versions comparées) |",
        f"| Tests automatisés | {passed}/{total} réussis |",
        f"| Date | {now} |",
        "| Responsable | Zakaria |",
        f"| Preuves brutes | `{rel}/` (logs, JSON vitest, rapports gitleaks) |",
        "",
        "## Couche 1 — contrôles déterministes (bloquants)",
        "",
        "| ID | Contrôle | Problème | Résultat | Preuve |",
        "|---|---|---|---|---|",
    ]
    for cid, title, prob, src in CONTROLS:
        st, proof = results[cid]
        icon = {"PASS": "✅ PASS", "N/A": "➖ N/A"}.get(st, "❌ FAIL")
        md.append(f"| {cid} | {title} | {prob} | {icon} | {proof.replace(chr(10), ' ')} <br>_Source : {src}_ |")
    md += [
        "",
        "Détail test par test : `tests-detail.md`.",
        "",
        "## Couches 2 et 3 (non automatisées)",
        "",
        "- Couche 2 — conformité critère par critère : relecture par une session neuve ou un autre modèle, qui doit citer l'endroit précis du livrable (voir `qa/criteres.md`).",
        "- Couche 3 — qualité rédactionnelle : consultative.",
        "",
        "## Réserves",
        "",
        "- Aucune." if verdict == "GO" else "- Version non livrable en l'état : corriger les contrôles en échec.",
        "",
        "## Non testé (hors périmètre)",
        "",
        *[f"- {x}" for x in OUT_OF_SCOPE],
        "",
    ]
    (out / "rapport-go-no-go.md").write_text("\n".join(md), encoding="utf-8")

    for cid, title, *_ in CONTROLS:
        print(f"  {results[cid][0]:4}  {cid}  {title}")
    print(f"\nTests : {passed}/{total} réussis")
    print(f"VERDICT : {verdict}   (rapport : {rel}/rapport-go-no-go.md)")
    return 0 if verdict == "GO" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except subprocess.CalledProcessError as e:
        print(f"Erreur d'exécution : {e.cmd} → {e.stderr}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:  # toute erreur du script ≠ NO-GO
        print(f"Erreur d'exécution : {e!r}", file=sys.stderr)
        sys.exit(2)
