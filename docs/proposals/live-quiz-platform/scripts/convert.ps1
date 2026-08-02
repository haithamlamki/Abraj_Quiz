param(
  [Parameter(Mandatory = $true)][string]$HtmlPath,
  [string]$FooterText = "Al Tanfith Al Dwaliah SPC  |  Page ",
  [double]$TopBottomMargin = 56.7,
  [double]$SideMargin = 56.7,
  [switch]$Rtl
)
$ErrorActionPreference = 'Stop'
$html   = (Resolve-Path $HtmlPath).Path
$outDir = Join-Path (Split-Path (Split-Path $html -Parent) -Parent) 'deliverables'
New-Item -ItemType Directory -Force $outDir | Out-Null
$base     = [IO.Path]::GetFileNameWithoutExtension($html)
$docxPath = Join-Path $outDir "$base.docx"
$pdfPath  = Join-Path $outDir "$base.pdf"
foreach ($p in @($docxPath, $pdfPath)) { if (Test-Path $p) { Remove-Item -Force $p } }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
# Pagination blocks for minutes if the system default printer is an unreachable
# network queue; point Word at a local driver WITHOUT changing the system default.
try {
  $wb = $word.WordBasic
  [void]$wb.GetType().InvokeMember('FilePrintSetup', [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $wb, @('Microsoft Print to PDF', 1), $null, $null, @('Printer', 'DoNotSetAsSysDefault'))
} catch { Write-Warning "FilePrintSetup fallback failed: $($_.Exception.Message)" }
$doc = $null
try {
  $doc = $word.Documents.Open($html)

  # A4, 2cm margins
  $doc.PageSetup.PaperSize    = 7      # wdPaperA4
  $doc.PageSetup.TopMargin    = $TopBottomMargin
  $doc.PageSetup.BottomMargin = $TopBottomMargin
  $doc.PageSetup.LeftMargin   = $SideMargin
  $doc.PageSetup.RightMargin  = $SideMargin

  # Footer: "<FooterText><PAGE field>"
  foreach ($sec in $doc.Sections) {
    $ftr = $sec.Footers.Item(1)                      # wdHeaderFooterPrimary
    $ftr.Range.Text = ($FooterText -replace '\s+$', '')
    # Word swallows a trailing space before an inserted field, gluing the page
    # number to the label ("صفحة1"). Insert a non-breaking space at the
    # collapsed insertion point instead, then add the field after it.
    $r = $ftr.Range
    $r.Collapse(0) | Out-Null                        # wdCollapseEnd
    $r.InsertAfter([string][char]0x00A0)
    $r = $ftr.Range
    $r.Collapse(0) | Out-Null
    $doc.Fields.Add($r, 33) | Out-Null               # wdFieldPage
    $ftr.Range.Font.Size = 8
    $ftr.Range.Font.Color = 0x7A6B5A                 # muted (BGR of #5A6B7A)
    $ftr.Range.ParagraphFormat.Alignment = 1         # centered
    # Footer paragraphs default to LTR reading order. In an Arabic footer that
    # reverses the whole Arabic block and strands the PAGE number on the wrong
    # side ("صفحة | شركة ... 1"). Force RTL reading order for AR documents.
    if ($Rtl) { $ftr.Range.ParagraphFormat.ReadingOrder = 0 }   # wdReadingOrderRtl (this COM build: 0=RTL, 1=LTR)
  }

  # Replace [[TOC]] placeholder with a real TOC field (headings 1-2)
  $rng = $doc.Content
  $rng.Find.Text = '[[TOC]]'
  if ($rng.Find.Execute()) {
    $rng.Text = ''
    $doc.TablesOfContents.Add($rng, $true, 1, 2) | Out-Null
  }
  if ($doc.TablesOfContents.Count -gt 0) {
    $doc.TablesOfContents.Item(1).Update() | Out-Null
    # TOC styles are left-to-right by default, which mangles Arabic entries whose
    # heading ends in a Latin parenthetical ("12. ... (AI)" -> "12AI). ... (").
    if ($Rtl) { $doc.TablesOfContents.Item(1).Range.ParagraphFormat.ReadingOrder = 0 }
  }

  $doc.Repaginate()
  $pages = $doc.ComputeStatistics(2)                 # wdStatisticPages
  $doc.SaveAs2($docxPath, 16)                        # wdFormatXMLDocument
  $doc.ExportAsFixedFormat($pdfPath, 17)             # wdExportFormatPDF
  Write-Output "OK pages=$pages docx=$docxPath pdf=$pdfPath"
}
finally {
  if ($doc) { $doc.Close($false) }
  $word.Quit()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
