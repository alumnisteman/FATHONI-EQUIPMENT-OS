# generate-wizard-art.ps1
# Menggambar artwork wizard Inno Setup FATHONI (maroon + roda 5 sirip) dan
# menyimpannya sebagai PNG 1x dan 2x di folder yang sama.
# Jalankan: powershell -NoProfile -ExecutionPolicy Bypass -File generate-wizard-art.ps1

Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$Maroon   = [System.Drawing.Color]::FromArgb(255, 126, 16, 21)   # #7E1015
$MaroonDk = [System.Drawing.Color]::FromArgb(255, 94, 10, 14)    # #5E0A0E
$Cream    = [System.Drawing.Color]::FromArgb(255, 246, 239, 228) # #F6EFE4
$White    = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)

function New-Canvas([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    return [pscustomobject]@{ Bmp = $bmp; G = $g }
}

# Roda 5 sirip: cincin luar, poros tengah, dan 5 tulang punggung melengkung.
# Semua koordinat tulang punggung dinyatakan dalam pecahan radius r.
function Draw-Impeller($g, [double]$cx, [double]$cy, [double]$r, [double]$strokePx, $color) {
    $pen = New-Object System.Drawing.Pen($color, [single]$strokePx)
    $g.DrawEllipse($pen, [single]($cx - $r), [single]($cy - $r), [single](2 * $r), [single](2 * $r))
    $hr = $r * 0.16
    $hub = New-Object System.Drawing.SolidBrush($color)
    $g.FillEllipse($hub, [single]($cx - $hr), [single]($cy - $hr), [single](2 * $hr), [single](2 * $hr))
    $state = $g.Save()
    $g.TranslateTransform([single]$cx, [single]$cy)
    for ($i = 0; $i -lt 5; $i++) {
        $g.RotateTransform(72.0)
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddBezier(
            [single](0.16 * $r), [single]0,
            [single](0.46 * $r), [single](-0.10 * $r),
            [single](0.74 * $r), [single](-0.32 * $r),
            [single](0.82 * $r), [single](-0.57 * $r))
        $g.DrawPath($pen, $path)
        $path.Dispose()
    }
    $g.Restore($state)
    $pen.Dispose(); $hub.Dispose()
}

# ── Gambar besar: panel samping halaman Selamat Datang / Selesai (164x314) ──
function New-SideImage([double]$scale) {
    $w = [int](164 * $scale); $h = [int](314 * $scale)
    $c = New-Canvas $w $h
    $g = $c.G
    $bg = New-Object System.Drawing.SolidBrush($Maroon)
    $g.FillRectangle($bg, 0, 0, $w, $h)
    $bg.Dispose()

    # garis rambut diagonal krem
    $hair = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(46, 246, 239, 228), [single](1 * $scale))
    $gap = 14 * $scale
    $diag = $w + $h
    for ($d = -$h; $d -lt $diag; $d += $gap) {
        $g.DrawLine($hair, [single]$d, [single]0, [single]($d + $h), [single]$h)
    }
    $hair.Dispose()

    # lingkaran besar yang terpotong tepi kiri
    $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $clip.AddRectangle((New-Object System.Drawing.Rectangle(0, 0, $w, $h)))
    $g.SetClip($clip)
    $clip.Dispose()
    $big = New-Object System.Drawing.SolidBrush($MaroonDk)
    $r = 132 * $scale
    $g.FillEllipse($big, [single](-0.34 * $r), [single](212 * $scale - $r), [single](2 * $r), [single](2 * $r))
    $big.Dispose()

    # roda 5 sirip di atas lingkaran
    $wm = [System.Drawing.Color]::FromArgb(214, 255, 255, 255)
    Draw-Impeller $g (96 * $scale) (206 * $scale) (46 * $scale) (3.2 * $scale) $wm
    $g.Dispose()
    return $c.Bmp
}

# ── Gambar kecil: ikon di banner atas (58x58) ──
function New-SmallImage([double]$scale) {
    $size = [int](58 * $scale)
    $c = New-Canvas $size $size
    $g = $c.G
    $radius = 11 * $scale
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [single](2 * $radius)
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $bg = New-Object System.Drawing.SolidBrush($Maroon)
    $g.FillPath($bg, $path)
    $bg.Dispose(); $path.Dispose()
    Draw-Impeller $g ($size / 2.0) ($size / 2.0) (21 * $scale) (3.6 * $scale) $White
    $g.Dispose()
    return $c.Bmp
}

$targets = @(
    @{ Name = 'fathoni-wizard-side';  Maker = { param($s) New-SideImage $s } },
    @{ Name = 'fathoni-wizard-small'; Maker = { param($s) New-SmallImage $s } }
)

foreach ($t in $targets) {
    foreach ($scale in 1.0, 2.0) {
        $bmp = & $t.Maker $scale
        $out = Join-Path $here ("{0}@{1}x.png" -f $t.Name, [int]$scale)
        $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        "written: $out"
    }
}

# ── Ikon .ico (PNG-in-ICO, Vista+) untuk SetupIconFile ──
function New-IconPng([int]$size) {
    $bmp = New-SmallImage ($size / 58.0)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return ,$ms.ToArray()
}

$iconSizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @($iconSizes | ForEach-Object { New-IconPng $_ })
$icoPath = Join-Path $here 'fathoni.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$pngs.Count)
$offset = 6 + (16 * $pngs.Count)
for ($i = 0; $i -lt $iconSizes.Count; $i++) {
    $s = $iconSizes[$i]
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $bw.Write([byte[]]$png) }
$bw.Flush(); $bw.Close(); $fs.Close()
"written: $icoPath"

# Versi 1x tanpa sufiks, dipakai oleh installer.
foreach ($t in $targets) {
    $src = Join-Path $here ("{0}@1x.png" -f $t.Name)
    Copy-Item $src (Join-Path $here ("{0}.png" -f $t.Name)) -Force
    "written: $(Join-Path $here ($t.Name + '.png'))"
}
