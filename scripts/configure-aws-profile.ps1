param([string]$Profile = 'dictionary-polly', [string]$Region = 'ap-southeast-2')
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$' -or $Region -notmatch '^[a-z]{2}(-[a-z]+)+-\d$') { throw 'Invalid profile or region.' }
$awsDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.aws'
New-Item -ItemType Directory -Path $awsDirectory -Force | Out-Null
$credentialsPath = Join-Path $awsDirectory 'credentials'
$configPath = Join-Path $awsDirectory 'config'
$credentials = if (Test-Path -LiteralPath $credentialsPath) { [IO.File]::ReadAllText($credentialsPath) } else { '' }
$config = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { '' }
if ($credentials -match ('(?m)^\[' + [regex]::Escape($Profile) + '\]\s*$')) { throw 'Profile already exists. Use a different name or rotate it with AWS CLI. Nothing overwritten.' }
Write-Host 'Enter credentials only here. Do not paste them into chat. Input is hidden.'
$accessSecret = Read-Host 'AWS access key ID' -AsSecureString
$keySecret = Read-Host 'AWS secret access key' -AsSecureString
$tokenSecret = Read-Host 'AWS session token (Enter if not using temporary credentials)' -AsSecureString
try {
  $access = [Net.NetworkCredential]::new('', $accessSecret).Password
  $secret = [Net.NetworkCredential]::new('', $keySecret).Password
  $token = [Net.NetworkCredential]::new('', $tokenSecret).Password
  if ($access -notmatch '^[A-Z0-9]{16,128}$' -or $secret.Length -lt 16 -or $secret -match '[\r\n]' -or $token -match '[\r\n]') { throw 'Invalid credential format. Nothing written.' }
  $section = "`n[$Profile]`naws_access_key_id = $access`naws_secret_access_key = $secret`n"
  if ($token) { $section += "aws_session_token = $token`n" }
  [IO.File]::WriteAllText($credentialsPath, $credentials.TrimEnd() + "`n" + $section, [Text.UTF8Encoding]::new($false))
  $configSection = if ($Profile -eq 'default') { 'default' } else { "profile $Profile" }
  if ($config -notmatch ('(?m)^\[' + [regex]::Escape($configSection) + '\]\s*$')) {
    [IO.File]::WriteAllText($configPath, $config.TrimEnd() + "`n[$configSection]`nregion = $Region`noutput = json`n", [Text.UTF8Encoding]::new($false))
  }
  Write-Host "Profile '$Profile' configured locally. Credentials were not printed or stored in the project."
} finally { Remove-Variable access,secret,token,section,accessSecret,keySecret,tokenSecret -ErrorAction SilentlyContinue }
