import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Chunk, Document


def citation_range(db: Session, doc: Document, target: Chunk) -> dict | None:
    """Locate an indexed chunk, allowing splitter whitespace changes and overlap.

    Walk chunks in document order so repeated passages resolve to their own occurrence.
    Offsets use UTF-16 code units, matching Markdown positions in the browser.
    """
    content = re.sub(r"\s", "", doc.content)
    cursor = 0
    for chunk in db.scalars(
        select(Chunk)
        .where(Chunk.document_id == doc.id, Chunk.ordinal <= target.ordinal)
        .order_by(Chunk.ordinal)
    ):
        text = re.sub(r"\s", "", chunk.text)
        start = content.find(text, cursor) if text else -1
        if start == -1:
            return None
        cursor = start + 1
        if chunk.id != target.id:
            continue
        end = start + len(text)
        normalized_offset = utf16_offset = 0
        highlight_start = None
        for char in doc.content:
            width = 2 if ord(char) > 0xFFFF else 1
            if not char.isspace():
                if normalized_offset == start:
                    highlight_start = utf16_offset
                normalized_offset += 1
                if normalized_offset == end:
                    return {"start": highlight_start, "end": utf16_offset + width}
            utf16_offset += width
    return None
