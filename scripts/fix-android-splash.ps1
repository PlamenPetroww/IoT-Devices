# Removes light corner artifacts from TWA splash PNGs (visible as white dots on launch).
# Force-paints corner boxes + thin edges to splash background #0F172A.
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
$bg = [System.Drawing.Color]::FromArgb(255, 15, 23, 42) # #0F172A

Get-ChildItem (Join-Path $root "app/src/main/res/drawable-*/splash.png") | ForEach-Object {
    $path = $_.FullName
    $src = [System.Drawing.Bitmap]::FromFile($path)
    $w = $src.Width
    $h = $src.Height
    $box = [Math]::Max(24, [int]([Math]::Min($w, $h) * 0.045))
    $edge = [Math]::Max(8, [int]([Math]::Min($w, $h) * 0.012))

    $out = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.Clear($bg)
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
    $src.Dispose()

    $fixed = 0
    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            $inCorner =
                ($x -lt $box -and $y -lt $box) -or
                ($x -ge ($w - $box) -and $y -lt $box) -or
                ($x -lt $box -and $y -ge ($h - $box)) -or
                ($x -ge ($w - $box) -and $y -ge ($h - $box))
            $nearEdge = ($x -lt $edge -or $y -lt $edge -or $x -ge ($w - $edge) -or $y -ge ($h - $edge))
            if (-not $inCorner -and -not $nearEdge) { continue }

            if ($inCorner) {
                $out.SetPixel($x, $y, $bg)
                $fixed++
                continue
            }

            $c = $out.GetPixel($x, $y)
            $lum = ([int]$c.R + [int]$c.G + [int]$c.B) / 3
            $dr = [Math]::Abs([int]$c.R - 15)
            $dg = [Math]::Abs([int]$c.G - 23)
            $db = [Math]::Abs([int]$c.B - 42)
            if ($c.A -lt 250 -or $lum -gt 35 -or $dr -gt 25 -or $dg -gt 25 -or $db -gt 25) {
                $out.SetPixel($x, $y, $bg)
                $fixed++
            }
        }
    }

    $tmp = "$path.tmp.png"
    $out.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    Remove-Item -Force $path
    Move-Item -Force $tmp $path
    Write-Host "Fixed $path (box=$box edge=$edge pixels=$fixed)"
}
