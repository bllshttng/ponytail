# CLAUDE_CONFIG_DIR overrides ~/.claude, matching where the hooks write the flag (issue #34)
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }

# Per-session flag isolates concurrent sessions (badge follows this session's mode).
# Claude pipes the statusline JSON on stdin; absent/odd session_id → shared flag.
$Sid = ""
try { $Sid = ([Console]::In.ReadToEnd() | ConvertFrom-Json).session_id } catch {}
$Flag = Join-Path $ClaudeDir ".ponytail-active"
if ($Sid -and $Sid -match '^[A-Za-z0-9_-]+$') {
    $Flag = Join-Path $ClaudeDir ".ponytail-active-$Sid"
}
if (-not (Test-Path $Flag)) {
    exit 0
}

$Mode = ""
try {
    $Mode = (Get-Content $Flag -ErrorAction Stop | Select-Object -First 1).Trim()
} catch {
    exit 0
}

$Esc = [char]27
if ([string]::IsNullOrEmpty($Mode) -or $Mode -eq "full") {
    [Console]::Write("${Esc}[38;5;108m[PONYTAIL]${Esc}[0m")
} else {
    $Suffix = $Mode.ToUpperInvariant()
    [Console]::Write("${Esc}[38;5;108m[PONYTAIL:$Suffix]${Esc}[0m")
}
