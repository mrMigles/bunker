Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot '../packages/client/public/assets'
$source = [System.Drawing.Bitmap]::new((Join-Path $assetDir 'survival-atlas.png'))
$target = [System.Drawing.Bitmap]::new(1024,1024)
$graphics = [System.Drawing.Graphics]::FromImage($target)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$cols = @(0,313,627,940,1254)
$rows = @(0,289,565,881,1254)
for ($row=0;$row -lt 4;$row++) {
  for ($col=0;$col -lt 4;$col++) {
    $srcRect = [System.Drawing.Rectangle]::new($cols[$col],$rows[$row],($cols[$col+1]-$cols[$col]),($rows[$row+1]-$rows[$row]))
    $dstRect = [System.Drawing.Rectangle]::new($col*256,$row*256,256,256)
    $graphics.DrawImage($source,$dstRect,$srcRect,[System.Drawing.GraphicsUnit]::Pixel)
  }
}
$target.Save((Join-Path $assetDir 'survival-atlas-grid.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $target.Dispose(); $source.Dispose()
