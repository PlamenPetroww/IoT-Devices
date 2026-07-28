# Removes light gray corner artifacts from TWA splash PNGs (visible as white dots on launch).
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
$bg = [System.Drawing.Color]::FromArgb(255, 15, 23, 42) # #0F172A – splash background

Get-ChildItem (Join-Path $root "app/src/main/res/drawable-*/splash.png") | ForEach-Object {
    $path = $_.FullName
    $src = [System.Drawing.Bitmap]::FromFile($path)
    $w = $src.Width
    $h = $src.Height
    $margin = [Math]::Max(12, [int]([Math]::Min($w, $h) * 0.02))

    $out = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.Clear($bg)
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
    $src.Dispose()

    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            $nearEdge = ($x -lt $margin -or $y -lt $margin -or $x -gt ($w - 1 - $margin) -or $y -gt ($h - 1 - $margin))
            if (-not $nearEdge) { continue }
            $c = $out.GetPixel($x, $y)
            if ($c.R -gt 180 -and $c.G -gt 180 -and $c.B -gt 180) {
                $out.SetPixel($x, $y, $bg)
            }
        }
    }

    $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    Write-Host "Fixed $path"
}
