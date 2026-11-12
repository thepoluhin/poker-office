# Сборка приложения в один файл: POKER\Покер Офис.exe
# Запуск:  powershell -ExecutionPolicy Bypass -File build.ps1
# Нужны Node.js 25.5+ (флаг --build-sea) и .NET Framework 4 (есть в Windows).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Split-Path -Parent $here
$root = Split-Path -Parent $src
$out = Join-Path $here '.out'
$exe = Join-Path $root ([string]::Concat([char]0x41F, [char]0x43E, [char]0x43A, [char]0x435, [char]0x440, ' ', [char]0x41E, [char]0x444, [char]0x438, [char]0x441, '.exe'))  # Покер Офис.exe
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null

Write-Host '1/4 tests'
Push-Location $src
node test.js | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
Pop-Location

Write-Host '2/4 server: Node.js + game in one exe'
& (Join-Path $here 'avatars.ps1')
node (Join-Path $here 'bundle.js') $out
if ($LASTEXITCODE -ne 0) { throw 'bundle failed' }
node --build-sea (Join-Path $out 'sea-config.json')
if ($LASTEXITCODE -ne 0) { throw 'build-sea failed' }

Write-Host '3/4 icon'
Add-Type -AssemblyName System.Drawing
function New-IconPng([int]$size) {
  $bmp = New-Object Drawing.Bitmap $size, $size
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $r = [single]($size * 0.22)
  $d = $r * 2
  $w = [single]($size - 1)
  $path = New-Object Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($w - $d, 0, $d, $d, 270, 90)
  $path.AddArc($w - $d, $w - $d, $d, $d, 0, 90)
  $path.AddArc(0, $w - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $rect = New-Object Drawing.RectangleF 0, 0, $size, $size
  $brush = New-Object Drawing.Drawing2D.LinearGradientBrush $rect, ([Drawing.Color]::FromArgb(61, 104, 150)), ([Drawing.Color]::FromArgb(27, 43, 62)), 60
  $g.FillPath($brush, $path)
  $font = New-Object Drawing.Font 'Segoe UI Symbol', ([single]($size * 0.62)), ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $box = New-Object Drawing.RectangleF 0, ([single]($size * 0.02)), $size, $size
  $g.DrawString([string][char]0x2660, $font, [Drawing.Brushes]::White, $box, $fmt)
  $g.Dispose()
  $ms = New-Object IO.MemoryStream
  $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return ,$ms.ToArray()
}
$sizes = 256, 64, 48, 32, 16
$pngs = $sizes | ForEach-Object { ,(New-IconPng $_) }
$ico = Join-Path $out 'poker.ico'
$fs = [IO.File]::Create($ico)
$bw = New-Object IO.BinaryWriter $fs
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $bw.Write([byte]($s % 256)); $bw.Write([byte]($s % 256)); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close()

Write-Host '4/4 window'
if (Test-Path $exe) { Remove-Item $exe -Force }
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/out:$exe" "/win32icon:$ico" `
  "/resource:$(Join-Path $out 'poker-server.exe'),poker-server.exe" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $src 'launcher\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }

Remove-Item $out -Recurse -Force
Write-Host ("done: {0:N1} MB" -f ((Get-Item $exe).Length / 1MB))
