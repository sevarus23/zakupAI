import concurrent.futures

# Import the original PDF pipeline (the slower variant)
from docling_pdf import run_pipeline as original_run_pipeline

# Imports for the fast pipeline:
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, TesseractOcrOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend

#
# FAST (fallback) pipeline using pypdfium2 via PyPdfiumDocumentBackend
#
def fast_run_pipeline(file_path: str, update_status, options, page_range):
    update_status("Fast conversion pipeline started.")
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = True
    pipeline_options.ocr_options = TesseractOcrOptions(lang=['rus', 'eng'])
    pipeline_options.do_table_structure = True
    pipeline_options.table_structure_options.do_cell_matching = True

    # Create a DocumentConverter using the PyPdfiumDocumentBackend
    doc_converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=pipeline_options,
                backend=PyPdfiumDocumentBackend
            )
        }
    )

    conv_result = doc_converter.convert(file_path)
    # The fast pipeline simply exports the document to Markdown.
    return conv_result.document.export_to_markdown()


#
# Combined run_pipeline for PDFs:
# First, attempt the original (potentially slower) pipeline.
# If it takes longer than 3 minutes (180 seconds), fall back to the fast pipeline.
#
def run_pipeline(file_path: str, update_status, options, page_range):
    update_status("Starting original PDF conversion pipeline.")
    try:
        # Use a ThreadPoolExecutor (or ProcessPoolExecutor if your pipeline is CPU-bound and picklable)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(original_run_pipeline, file_path, update_status, options, page_range)
            # Wait up to 180 seconds.
            return future.result(timeout=180)
    except concurrent.futures.TimeoutError:
        update_status("\033[91mOriginal PDF conversion timed out. Falling back to fast conversion pipeline.\033[0m")
        return fast_run_pipeline(file_path, update_status, options, page_range)
