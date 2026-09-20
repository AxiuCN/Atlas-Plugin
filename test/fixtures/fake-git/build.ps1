# 编译 git 替身到 test/.test-tmp/fake-git/git.exe（产物不入库）
#
# 用法：pwsh -File test/fixtures/fake-git/build.ps1
#   套件（codex-sync.test.mjs）会在找不到产物时自动调用本脚本；编译不出则跳过该套件。
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $here '../../.test-tmp/fake-git'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$src = Join-Path $here 'FakeGit.cs'
$exe = Join-Path $outDir 'git.exe'

# 优先用 .NET Framework 自带的 csc.exe
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }

if (Test-Path $csc) {
  & $csc /nologo /target:exe "/out:$exe" $src | Out-Null
} else {
  Add-Type -Path $src -OutputAssembly $exe -OutputType ConsoleApplication
}

if (Test-Path $exe) {
  Write-Host "已生成 $exe"
} else {
  Write-Error "编译失败，未生成 $exe"
}
