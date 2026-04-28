param(
    [Parameter(Mandatory = $true)]
    [string[]]$Files
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

foreach ($file in $Files) {
    if (-not (Test-Path -LiteralPath $file)) {
        throw "File not found: $file"
    }

    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("mdocx-sanitize-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    try {
        $zipCopy = Join-Path $tempRoot ([IO.Path]::GetFileNameWithoutExtension($file) + ".zip")
        Copy-Item -LiteralPath $file -Destination $zipCopy -Force

        $extractDir = Join-Path $tempRoot "unzipped"
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipCopy, $extractDir)

        $corePath = Join-Path $extractDir "docProps\core.xml"
        if (Test-Path -LiteralPath $corePath) {
            [xml]$core = Get-Content -LiteralPath $corePath
            $ns = New-Object System.Xml.XmlNamespaceManager($core.NameTable)
            $ns.AddNamespace("dc", "http://purl.org/dc/elements/1.1/")
            $ns.AddNamespace("cp", "http://schemas.openxmlformats.org/package/2006/metadata/core-properties")

            foreach ($xpath in @("//dc:creator", "//cp:lastModifiedBy", "//dc:subject", "//cp:keywords")) {
                $nodes = $core.SelectNodes($xpath, $ns)
                foreach ($node in $nodes) {
                    $node.InnerText = ""
                }
            }

            $revisionNodes = $core.SelectNodes("//cp:revision", $ns)
            foreach ($node in $revisionNodes) {
                $node.InnerText = "1"
            }

            $core.Save($corePath)
        }

        $appPath = Join-Path $extractDir "docProps\app.xml"
        if (Test-Path -LiteralPath $appPath) {
            [xml]$app = Get-Content -LiteralPath $appPath
            $appNs = New-Object System.Xml.XmlNamespaceManager($app.NameTable)
            $appNs.AddNamespace("ap", "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties")

            $valueMap = @{
                "//ap:Company" = ""
                "//ap:Manager" = ""
                "//ap:Template" = "Normal.dotm"
                "//ap:TotalTime" = "0"
                "//ap:Pages" = "1"
                "//ap:Words" = "0"
                "//ap:Characters" = "0"
                "//ap:Lines" = "0"
                "//ap:Paragraphs" = "0"
                "//ap:CharactersWithSpaces" = "0"
            }

            foreach ($entry in $valueMap.GetEnumerator()) {
                $nodes = $app.SelectNodes($entry.Key, $appNs)
                foreach ($node in $nodes) {
                    $node.InnerText = $entry.Value
                }
            }

            $hLinksNodes = $app.SelectNodes("//ap:HLinks", $appNs)
            foreach ($node in $hLinksNodes) {
                $node.ParentNode.RemoveChild($node) | Out-Null
            }

            $app.Save($appPath)
        }

        $rebuiltZip = Join-Path $tempRoot "rebuilt.zip"
        if (Test-Path -LiteralPath $rebuiltZip) {
            Remove-Item -LiteralPath $rebuiltZip -Force
        }
        [System.IO.Compression.ZipFile]::CreateFromDirectory($extractDir, $rebuiltZip)
        Copy-Item -LiteralPath $rebuiltZip -Destination $file -Force
    }
    finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

