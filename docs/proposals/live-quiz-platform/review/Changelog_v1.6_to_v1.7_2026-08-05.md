# Changelog v1.6 → v1.7 2026-08-05

**1.7 Company logo added to document covers and headers. No content, pricing, or scope changes.**

The Al Tanfith Al Dwaliah SPC logo now appears in all six documents. The supplied artwork
(1254×1254 PNG, opaque white background) was prepared for the navy covers as a circular badge:
a GDI+ circle-clip made everything outside the inscribed circle transparent (the white disc,
arc text, and interior of the mark are preserved), then downscaled to 600×600 (257 KB) at
`src/assets/logo.png`. A straight white-to-transparent flood fill was rejected: it leaked
through the ring's opening and hollowed out the badge interior.

Placement (EN + AR):

- **Proposal and Quotation covers**: 110×110 badge above the company name; alignment follows
  the cover cell's direction (top-left EN, top-right AR).
- **Executive summaries**: 62×62 badge in a second navy cell of the header band (right side EN,
  left side AR), vertically centred; band height essentially unchanged and both summaries still
  render at exactly one page with the 42.5 margins.
- **Version + revision row** updated in all 6 documents, including the exec-summary fine-print
  revision note (the v1.6 lesson). Offer date 28/07/2026 and validity 27/08/2026 unchanged.

QA: six rendered pages inspected (4 covers + 2 exec summaries, both languages) — transparency
correct on navy, no white box, arc text legible, RTL mirroring correct; claims lint OK; page
counts unchanged (proposal EN 48 / AR 45, quotation 8 / 7, exec 1 + 1).
