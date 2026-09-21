"""A spreadsheet must never be sent to a model as a picture.

    "also it only accpeintg images png...whats the hell it need to acceppt
     litrelly all type of dcouements"

These are pure functions with no database, which is deliberate: the bug they
guard against is a WRONG CONTENT BLOCK, and a wrong content block is invisible
until AWS rejects it in production. Asserting the block shape locally is the
only cheap way to know.
"""
import csv
import io

import pytest

from app.assistant import docbytes


def _workbook() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Supplier", "Contact", "Mobile"])
    ws.append(["Chennai Fresh", "Raja", "07700900111"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def test_a_workbook_becomes_csv_text_not_an_image():
    """THE REGRESSION. `understand_document` wrapped this in an image block
    labelled with the xlsx content type; Bedrock's image block takes jpeg, png,
    gif and webp, so it was rejected by AWS after passing our own checks."""
    blocks = docbytes.blocks(_workbook(), XLSX_MIME, "vendors.xlsx", "Read this.")

    assert len(blocks) == 1
    assert blocks[0]["type"] == "text"
    assert "Chennai Fresh" in blocks[0]["text"], "the rows have to survive the flattening"
    assert "Read this." in blocks[0]["text"]


def test_an_octet_stream_xlsx_is_still_a_spreadsheet():
    """CONTENT TYPES LIE, and this is the one that bit him: a file downloaded
    from this product and re-uploaded from Windows arrives as octet-stream."""
    blocks = docbytes.blocks(_workbook(), "application/octet-stream", "vendors.xlsx", "Read.")
    assert blocks[0]["type"] == "text"
    assert "Chennai Fresh" in blocks[0]["text"]


def test_a_csv_goes_in_as_text():
    buf = io.StringIO()
    csv.writer(buf).writerows([["Supplier"], ["Madras Spice Co"]])
    blocks = docbytes.blocks(buf.getvalue().encode(), "text/csv", "our-export.csv", "Read.")
    assert len(blocks) == 1
    assert blocks[0]["type"] == "text"
    assert "Madras Spice Co" in blocks[0]["text"]


def test_a_csv_mislabelled_octet_stream_is_still_text():
    blocks = docbytes.blocks(b"Supplier\nMadras Spice Co\n", "application/octet-stream",
                             "dineai-vendors.csv", "Read.")
    assert blocks[0]["type"] == "text"
    assert "Madras Spice Co" in blocks[0]["text"]


def test_a_photo_is_still_a_photo():
    """The loosening must not break the case that always worked — a snap of a
    delivery note is how most bills still arrive."""
    blocks = docbytes.blocks(b"\x89PNG\r\n\x1a\n fake", "image/png", "bill.png", "Read.")
    assert blocks[0]["type"] == "image"
    assert blocks[0]["source"]["media_type"] == "image/png"
    assert blocks[1]["type"] == "text"


def test_a_pdf_is_a_document_block():
    """A supplier invoice and a restaurant menu both normally arrive as PDFs,
    and two endpoints used to refuse them outright."""
    blocks = docbytes.blocks(b"%PDF-1.4 fake", "application/pdf", "invoice.pdf", "Read.")
    assert blocks[0]["type"] == "document"
    assert blocks[0]["source"]["media_type"] == "application/pdf"


def test_an_unknown_type_is_attempted_rather_than_refused():
    """An unknown type goes to the model, which can say it cannot read it. Our
    guess about file formats is the thing that was wrong before."""
    blocks = docbytes.blocks(b"whatever", "application/x-who-knows", "thing.bin", "Read.")
    assert blocks[0]["type"] == "document"


def test_a_corrupt_workbook_does_not_raise():
    """One bad file must not become a 500. The model is told the sheet looked
    empty, which is a sentence a person can act on."""
    blocks = docbytes.blocks(b"not really a workbook", XLSX_MIME, "broken.xlsx", "Read.")
    assert blocks[0]["type"] == "text"
    assert "empty or unreadable" in blocks[0]["text"]


@pytest.mark.parametrize("name", ["backup.zip", "clip.mp4", "song.mp3", "setup.exe"])
def test_archives_and_media_are_the_only_refusals(name):
    assert docbytes.is_unreadable(name) is True


@pytest.mark.parametrize(
    "name", ["vendors.xlsx", "list.csv", "menu.pdf", "photo.jpg", "notes.txt", "thing.bin"]
)
def test_everything_else_gets_through(name):
    """The deny-list must stay a deny-list. The allow-list it replaced is what
    told him to send a PNG of his spreadsheet."""
    assert docbytes.is_unreadable(name) is False


def test_the_text_cap_is_applied():
    """A year's export must not blow the context window."""
    big = ("x" * 10) + ("y" * docbytes.MAX_TEXT_CHARS)
    blocks = docbytes.blocks(big.encode(), "text/csv", "huge.csv", "Read.")
    assert len(blocks[0]["text"]) < docbytes.MAX_TEXT_CHARS + 2000
