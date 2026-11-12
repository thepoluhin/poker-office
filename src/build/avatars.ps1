# Готовит аватарки для игры: уменьшает исходники из avatars-source до 256x256
# и пишет список в public\avatars\index.json. Новая картинка в avatars-source
# появится в игре после запуска этого скрипта (его вызывает и build.ps1).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Split-Path -Parent $here
$from = Join-Path $src 'avatars-source'
$to = Join-Path $src 'public\avatars'
$size = 256

Add-Type -AssemblyName System.Drawing
if (Test-Path $to) { Remove-Item $to -Recurse -Force }
New-Item -ItemType Directory $to | Out-Null

$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long]88)

$ids = @()
Get-ChildItem $from -File | Where-Object { $_.Extension -match '^\.(jpe?g|png|webp)$' } | Sort-Object Name | ForEach-Object {
  $id = $_.BaseName.ToLower() -replace '[^a-z0-9-]', ''
  if (-not $id) { return }
  $img = [Drawing.Image]::FromFile($_.FullName)
  # квадрат по центру, затем уменьшение
  $side = [Math]::Min($img.Width, $img.Height)
  $crop = New-Object Drawing.Rectangle ([int](($img.Width - $side) / 2)), ([int](($img.Height - $side) / 2)), $side, $side
  $bmp = New-Object Drawing.Bitmap $size, $size
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.SmoothingMode = 'HighQuality'
  $g.DrawImage($img, (New-Object Drawing.Rectangle 0, 0, $size, $size), $crop, [Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $img.Dispose()
  $bmp.Save((Join-Path $to "$id.jpg"), $jpeg, $params)
  $bmp.Dispose()
  $ids += $id
}
$json = '[' + (($ids | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'
[IO.File]::WriteAllText((Join-Path $to 'index.json'), $json, (New-Object Text.UTF8Encoding $false))
Write-Host ("avatars: {0}, {1:N0} KB total" -f $ids.Count, ((Get-ChildItem $to -Filter *.jpg | Measure-Object Length -Sum).Sum / 1KB))
