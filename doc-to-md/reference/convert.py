import sys
import os
from pathlib import Path
from typing import Tuple, Union

import pypdfium2 as pdfium
from docling_simple_pdf import run_pipeline as run_pdf_pipeline
from docling_doc import run_pipeline as run_office_pipeline
from docling.exceptions import ConversionError

DEFAULT_PAGE_RANGE = (1, 20)

class DoclingConverter:
    def __init__(self, update_status_callback=None, options: dict = None):
        self.update_status = update_status_callback or (lambda msg: None)
        self.options = options or {}

    def convert_to_markdown(self, file_path: Union[str, Path], page_range: Tuple[int, int]) -> str:
        p = Path(file_path)
        if not p.exists():
            raise FileNotFoundError(p)
        suffix = p.suffix.lower()
        if suffix == '.pdf':
            return run_pdf_pipeline(str(p), self.update_status, self.options, page_range)
        elif suffix in ('.docx', '.pptx', '.xlsx'):
            # note: office pipeline ignores page_range
            return run_office_pipeline(str(p), self.update_status)
        else:
            raise ValueError(f"Unsupported format: {suffix}")

    def convert_to_markdown_file(self, input_path: Union[str, Path], output_path: Union[str, Path],
                                 page_range: Tuple[int, int]):
        md = self.convert_to_markdown(input_path, page_range)
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(md, encoding='utf-8')

def get_pdf_page_count(fp: Union[str, Path]) -> int:
    return len(pdfium.PdfDocument(str(fp)))

def build_page_range(p: Path, mode: str):
    """mode='ed' or 'common'"""
    if p.suffix.lower() != '.pdf':
        return DEFAULT_PAGE_RANGE
    total = get_pdf_page_count(p)
    if mode == 'ed':
        # last 3 pages
        start = max(1, total - 2)
        end = total
    else:
        # common: last 20 pages
        start = max(1, total - 19)
        end = total
    return (start, end)

def is_too_large_xlsx(p: Path):
    return p.suffix.lower() == '.xlsx' and (p.stat().st_size / 1024) > 50

def process_subdir(tender_dir: Path, out_root: Path, converter: DoclingConverter):
    for mode in ('ed', 'common'):
        in_dir  = tender_dir / mode
        out_dir = out_root  / tender_dir.relative_to(refined_root) / mode
        if not in_dir.exists():
            continue

        # collect docs
        docs = []
        for ext in ('*.docx', '*.xlsx', '*.pptx', '*.pdf'):
            docs.extend(in_dir.rglob(ext))

        for doc in docs:
            if is_too_large_xlsx(doc):
                print("  skip too large:", doc)
                continue

            pr = build_page_range(doc, mode)
            rel = doc.relative_to(refined_root)
            target = out_root / rel.with_suffix('.md')

            try:
                print("  convert:", rel, "â†’", target.relative_to(out_root))
                converter.convert_to_markdown_file(doc, target, pr)
            except ConversionError as ce:
                print("  ConversionError:", doc, ce)
            except Exception as e:
                print("  ERROR:", doc, e)

def sync_back(md_root: Path, refined_root: Path):
    """Copy all .md from docs_md back into docs_refined in the same ed/common folder."""
    for md in md_root.rglob("*.md"):
        rel = md.relative_to(md_root)
        dest = refined_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        md.replace(dest)  # atomic move; if you prefer copy use shutil.copy2

if __name__ == "__main__":
    refined_root = Path('docs_refined')
    md_root      = Path('docs_md')
    do_sync      = False

    converter = DoclingConverter()
    # walk date/client/template/tender_*
    for date_dir in sorted(refined_root.iterdir()):
        if not date_dir.is_dir(): continue
        for client in sorted(date_dir.iterdir()):
            if not client.is_dir(): continue
            for tpl in sorted(client.iterdir()):
                if not tpl.is_dir(): continue
                for tender in sorted(tpl.iterdir()):
                    if not tender.is_dir(): continue
                    print("Processing", tender.relative_to(refined_root))
                    process_subdir(tender, md_root, converter)

    if do_sync:
        print("Syncing back to refined treeâ€¦")
        sync_back(md_root, refined_root)
        print("Done.")
