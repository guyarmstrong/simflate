# Convert a binary PPM (P6) to PNG: powershell -File scripts/ppm2png.ps1 in.ppm out.png
param([string]$In, [string]$Out)
Add-Type -AssemblyName System.Drawing
$bytes = [System.IO.File]::ReadAllBytes($In)
# Header: "P6 W H 255\n"
$nl = [Array]::IndexOf($bytes, [byte]10)
$hdr = [System.Text.Encoding]::ASCII.GetString($bytes, 0, $nl).Split(' ')
$w = [int]$hdr[1]; $h = [int]$hdr[2]
$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
$stride = $data.Stride
$row = New-Object byte[] $stride
for ($y = 0; $y -lt $h; $y++) {
  $src = $nl + 1 + $y * $w * 3
  for ($x = 0; $x -lt $w; $x++) {
    $row[3*$x] = $bytes[$src + 3*$x + 2]; $row[3*$x+1] = $bytes[$src + 3*$x + 1]; $row[3*$x+2] = $bytes[$src + 3*$x]
  }
  [System.Runtime.InteropServices.Marshal]::Copy($row, 0, [IntPtr]($data.Scan0.ToInt64() + $y * $stride), $stride)
}
$bmp.UnlockBits($data)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
