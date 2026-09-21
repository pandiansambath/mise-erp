"""Turning an uploaded file into something a model can actually read.

    "also it only accpeintg images png...whats the hell it need to acceppt
     litrelly all type of dcouements"

THIS FILE EXISTS BECAUSE THE FIX FOR THAT WAS APPLIED IN ONE PLACE OUT OF TWO.

The refusal he hit was a check in front of the AI upload that allowed four
image types. That check was widened to a deny-list — archives and video out,
everything else in — and the door opened. But the thing behind the door,
`bedrock.understand_document`, wrapped whatever arrived in an `{"type":
"image"}` block and labelled it with the browser's content type. Bedrock's
image block takes jpeg, png, gif and webp and nothing else, so a spreadsheet
stopped being refused politely at our edge and started being rejected by AWS
instead — the same wall, one step further back and with a worse error.

Meanwhile `ingest.extract` had solved it properly for the onboarding upload:
text straight in as text, a workbook flattened to CSV first, everything else
as a document block. Two readers, one right and one wrong, both reachable from
buttons a person would call "upload a file to the AI".

So the decoding lives HERE, once, and both call it. The rule it encodes:

  * A SPREADSHEET IS NOT A PICTURE. No model reads an .xlsx binary; handed one
    it produces confident nonsense rather than an error, which is worse.
  * CONTENT TYPES LIE. A .csv this product exported, re-uploaded from Windows,
    commonly arrives as `application/octet-stream`; a phone labels almost
    anything that way. The suffix is the better signal, so both are consulted
    and either one is enough.
  * AN UNKNOWN TYPE IS ATTEMPTED, NOT REFUSED. If the model genuinely cannot
    read it, it says so, and that sentence is more use to a restaurant than
    our guess about file formats.
"""

from __future__ import annotations

import base64
import csv
import io

#: Things that are already text. Read them AS text — the model reads a CSV far
#: better than it reads a picture of one, and it costs a fraction as much.
_TEXT_MIMES = {
    "text/csv",
    "text/plain",
    "text/tab-separated-values",
    "application/csv",
    "application/json",
}
_TEXT_SUFFIXES = (".csv", ".txt", ".tsv", ".json", ".md")

_EXCEL_MIMES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroenabled.12",
}
_EXCEL_SUFFIXES = (".xlsx", ".xlsm", ".xls")

#: What we genuinely cannot read. A DENY-list, deliberately: the allow-list it
#: replaced is what told him to send a PNG of his spreadsheet.
UNREADABLE_SUFFIXES = (".zip", ".rar", ".7z", ".exe", ".dmg", ".mp4", ".mov", ".mp3", ".wav")

#: How much of a text file to hand over. Big enough for a real supplier list,
#: small enough not to blow the context window on somebody's export of a year.
MAX_TEXT_CHARS = 200_000
MAX_SHEET_ROWS = 500


def is_text(mime: str, filename: str = "") -> bool:
    if (mime or "").split(";")[0].strip() in _TEXT_MIMES:
        return True
    return (filename or "").lower().endswith(_TEXT_SUFFIXES)


def is_excel(mime: str, filename: str = "") -> bool:
    if (mime or "").split(";")[0].strip() in _EXCEL_MIMES:
        return True
    return (filename or "").lower().endswith(_EXCEL_SUFFIXES)


def is_unreadable(filename: str = "") -> bool:
    return (filename or "").lower().endswith(UNREADABLE_SUFFIXES)


def xlsx_to_csv(file_bytes: bytes, max_rows: int = MAX_SHEET_ROWS) -> str:
    """Flatten the first worksheet to CSV text.

    Best-effort by design: a corrupt or unsupported workbook returns "" and the
    model is told the sheet looked empty, which is a sentence a person can act
    on. Raising here would turn one bad file into a 500.
    """
    try:
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        out = io.StringIO()
        w = csv.writer(out)
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i >= max_rows:
                break
            w.writerow(["" if c is None else c for c in row])
        return out.getvalue()
    except Exception:  # noqa: BLE001 — bad file → the model sees nothing, not a crash
        return ""


def blocks(file_bytes: bytes, mime: str, filename: str, prompt: str) -> list[dict]:
    """The Bedrock `content` array for one uploaded file plus its instruction.

    The prompt goes AFTER an image or document block and is folded INTO the
    text block when the file is already text — because a text block followed
    by a text block is just a longer prompt, and splitting it invites the model
    to treat the second half as the more important one.
    """
    if is_text(mime, filename):
        body = file_bytes.decode("utf-8-sig", errors="replace")[:MAX_TEXT_CHARS]
        return [{"type": "text", "text": f"{prompt}\n\nFILE CONTENTS:\n{body}"}]

    if is_excel(mime, filename):
        sheet = xlsx_to_csv(file_bytes)
        body = sheet or "(the spreadsheet appeared to be empty or unreadable)"
        return [{"type": "text", "text": f"{prompt}\n\nSPREADSHEET CONTENTS (CSV):\n{body}"}]

    media = (mime or "").split(";")[0].strip()
    is_image = media.startswith("image/")
    return [
        {
            "type": "image" if is_image else "document",
            "source": {
                "type": "base64",
                # A document block is PDF as far as Bedrock is concerned. A
                # .docx labelled application/pdf is still wrong, but it is
                # wrong in a way the model reports rather than one that 500s.
                "media_type": media if is_image else "application/pdf",
                "data": base64.b64encode(file_bytes).decode(),
            },
        },
        {"type": "text", "text": prompt},
    ]
