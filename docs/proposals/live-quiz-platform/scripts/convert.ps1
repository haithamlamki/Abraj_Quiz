param(
  [Parameter(Mandatory = $true)][string]$HtmlPath,
  [string]$FooterText = "Altanfith Aldwaliah SPC  |  Confidential  |  Page "
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
$doc = $null
try {
  $doc = $word.Documents.Open($html)

  # A4, 2cm margins
  $doc.PageSetup.PaperSize    = 7      # wdPaperA4
  $doc.PageSetup.TopMargin    = 56.7
  $doc.PageSetup.BottomMargin = 56.7
  $doc.PageSetup.LeftMargin   = 56.7
  $doc.PageSetup.RightMargin  = 56.7

  # Footer: "<FooterText><PAGE field>"
  foreach ($sec in $doc.Sections) {
    $ftr = $sec.Footers.Item(1)                      # wdHeaderFooterPrimary
    $ftr.Range.Text = $FooterText
    $r = $ftr.Range
    $r.Collapse(0) | Out-Null                        # wdCollapseEnd
    $doc.Fields.Add($r, 33) | Out-Null               # wdFieldPage
    $ftr.Range.Font.Size = 8
    $ftr.Range.Font.Color = 0x7A6B5A                 # muted (BGR of #5A6B7A)
    $ftr.Range.ParagraphFormat.Alignment = 1         # centered
  }

  # Replace [[TOC]] placeholder with a real TOC field (headings 1-2)
  $rng = $doc.Content
  $rng.Find.Text = '[[TOC]]'
  if ($rng.Find.Execute()) {
    $rng.Text = ''
    $doc.TablesOfContents.Add($rng, $true, 1, 2) | Out-Null
  }
  if ($doc.TablesOfContents.Count -gt 0) { $doc.TablesOfContents.Item(1).Update() | Out-Null }

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
