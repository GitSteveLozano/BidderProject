"""Compile docs/brief.md (and architecture spec, demo storyboard) into PDFs.

Prefers pandoc (best output). Falls back to weasyprint (pure-python via
HTML). If neither is available, prints install instructions.

Run: python scripts/build_brief.py
     python scripts/build_brief.py --pdf-engine pandoc
     python scripts/build_brief.py --output dist/
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DEFAULT_OUTPUT = ROOT / "dist"

# Map source markdown → output PDF name
SOURCES = {
    "docs/brief.md": "ProService-Bid-Intelligence-Brief.pdf",
    "docs/architecture_spec_v2.md": "ProService-Bid-Intelligence-Architecture-v2.pdf",
    "docs/demo_storyboard.md": "ProService-Demo-Storyboard.pdf",
    "docs/ARCHITECTURE.md": "ProService-Codebase-Architecture.pdf",
}


def _have(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def build_with_pandoc(src: Path, dst: Path) -> bool:
    """Try pandoc with xelatex/wkhtmltopdf engine, then plain pandoc."""
    engines_to_try = []
    if _have("xelatex"):
        engines_to_try.append(["--pdf-engine=xelatex"])
    if _have("wkhtmltopdf"):
        engines_to_try.append(["--pdf-engine=wkhtmltopdf"])
    engines_to_try.append([])  # let pandoc pick

    for engine_args in engines_to_try:
        cmd = ["pandoc", str(src), "-o", str(dst), *engine_args,
               "--toc", "--toc-depth=2",
               "-V", "geometry:margin=1in",
               "-V", "linkcolor=blue"]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return True
        except subprocess.CalledProcessError as e:
            print(f"  pandoc engine {engine_args or '[default]'} failed: "
                  f"{e.stderr.strip().splitlines()[-1] if e.stderr else e}", file=sys.stderr)
            continue
    return False


def build_with_weasyprint(src: Path, dst: Path) -> bool:
    try:
        import markdown  # type: ignore[import-not-found]
        from weasyprint import HTML  # type: ignore[import-not-found]
    except ImportError:
        return False

    md_text = src.read_text(encoding="utf-8")
    html_body = markdown.markdown(
        md_text, extensions=["tables", "fenced_code", "toc"]
    )
    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{src.stem}</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif;
          max-width: 6.5in; margin: 0.75in auto; color: #222; }}
  h1, h2, h3 {{ color: #111; }}
  code, pre {{ background: #f4f4f4; padding: 0.2em 0.4em;
               border-radius: 3px; font-size: 0.9em; }}
  pre {{ padding: 0.6em; overflow: auto; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1em 0; }}
  th, td {{ border: 1px solid #ccc; padding: 0.4em 0.6em; text-align: left; }}
  th {{ background: #fafafa; }}
  blockquote {{ border-left: 3px solid #ccc; margin: 1em 0;
                padding-left: 1em; color: #555; }}
  hr {{ border: none; border-top: 1px solid #ddd; margin: 2em 0; }}
</style>
</head><body>{html_body}</body></html>"""
    HTML(string=html).write_pdf(str(dst))
    return True


def build(src: Path, dst: Path, engine: str) -> bool:
    if engine in ("pandoc", "auto") and _have("pandoc"):
        if build_with_pandoc(src, dst):
            return True
    if engine in ("weasyprint", "auto"):
        if build_with_weasyprint(src, dst):
            return True
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compile docs to PDF")
    parser.add_argument(
        "--engine",
        choices=["auto", "pandoc", "weasyprint"],
        default="auto",
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--only", help="Compile a single source file")
    args = parser.parse_args(argv)

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.only:
        sources = {args.only: Path(args.only).stem + ".pdf"}
    else:
        sources = SOURCES

    errors = 0
    for src_rel, dst_name in sources.items():
        src = ROOT / src_rel
        if not src.exists():
            print(f"⚠  source not found: {src_rel}", file=sys.stderr)
            errors += 1
            continue
        dst = out_dir / dst_name
        print(f"  → {dst}")
        if not build(src, dst, args.engine):
            print(f"    ✗ build failed", file=sys.stderr)
            errors += 1

    if errors:
        print("\nIf no PDF was produced, install one of:", file=sys.stderr)
        print("  • pandoc:     brew install pandoc  /  apt-get install pandoc", file=sys.stderr)
        print("  • weasyprint: pip install weasyprint markdown", file=sys.stderr)
        return 1
    print(f"\n✓ wrote {len(sources)} PDF(s) to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
