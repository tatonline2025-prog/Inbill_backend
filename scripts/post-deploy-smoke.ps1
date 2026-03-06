param(
  [string]$BaseUrl = "https://api.dvtienich.vn",
  [string]$AdminUser = "",
  [string]$AdminPass = "",
  [string]$UserUser = "",
  [string]$UserPass = "",
  [string]$AdminToken = "",
  [string]$UserToken = "",
  [switch]$SkipAuth,
  [switch]$SkipAuthorizationChecks,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

function Normalize-BaseUrl {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) { return "" }
  return $Url.TrimEnd("/")
}

function Parse-JsonSafe {
  param([string]$Content)
  if ([string]::IsNullOrWhiteSpace($Content)) { return $null }
  try {
    return $Content | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Invoke-Http {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $requestParams = @{
    Method = $Method
    Uri = $Url
    Headers = $Headers
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $requestParams.ContentType = "application/json"
    $requestParams.Body = ($Body | ConvertTo-Json -Depth 12 -Compress)
  }

  try {
    $resp = Invoke-WebRequest @requestParams
    $content = [string]$resp.Content
    return [PSCustomObject]@{
      Status = [int]$resp.StatusCode
      Content = $content
      Json = Parse-JsonSafe -Content $content
      Error = $null
    }
  } catch {
    $webResp = $_.Exception.Response
    if ($null -eq $webResp) {
      return [PSCustomObject]@{
        Status = -1
        Content = ""
        Json = $null
        Error = $_.Exception.Message
      }
    }

    $statusCode = [int]$webResp.StatusCode
    $reader = New-Object System.IO.StreamReader($webResp.GetResponseStream())
    $content = $reader.ReadToEnd()
    $reader.Close()
    return [PSCustomObject]@{
      Status = $statusCode
      Content = $content
      Json = Parse-JsonSafe -Content $content
      Error = $null
    }
  }
}

$Results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param(
    [string]$Check,
    [string]$Expected,
    [string]$Actual,
    [string]$Status,
    [string]$Note = ""
  )
  $Results.Add([PSCustomObject]@{
    Check = $Check
    Expected = $Expected
    Actual = $Actual
    Status = $Status
    Note = $Note
  }) | Out-Null
}

$BaseUrl = Normalize-BaseUrl -Url $BaseUrl
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  Write-Error "BaseUrl is required."
  exit 1
}

if ($DryRun) {
  Write-Host "[DRY-RUN] post-deploy smoke script is valid."
  Write-Host "BaseUrl: $BaseUrl"
  Write-Host "SkipAuth: $SkipAuth | SkipAuthorizationChecks: $SkipAuthorizationChecks"
  exit 0
}

Write-Host "Running post-deploy smoke check..."
Write-Host "Target: $BaseUrl"

# 1) Health check
$health = Invoke-Http -Method "GET" -Url "$BaseUrl/health"
if ($health.Status -eq 200 -and $health.Json -and $health.Json.status -eq "ok") {
  Add-Result -Check "GET /health" -Expected "HTTP 200, status=ok" -Actual "HTTP $($health.Status), status=$($health.Json.status)" -Status "PASS"
} else {
  Add-Result -Check "GET /health" -Expected "HTTP 200, status=ok" -Actual "HTTP $($health.Status), body=$($health.Content)" -Status "FAIL"
}

function Get-TokenFromLogin {
  param([string]$UserName, [string]$Password)
  if ([string]::IsNullOrWhiteSpace($UserName) -or [string]::IsNullOrWhiteSpace($Password)) {
    return ""
  }
  $resp = Invoke-Http -Method "POST" -Url "$BaseUrl/api/auth/login" -Body @{
    userName = $UserName
    password = $Password
  }
  if ($resp.Status -eq 200 -and $resp.Json -and $resp.Json.token) {
    return [string]$resp.Json.token
  }
  return ""
}

if (-not $SkipAuth) {
  if ([string]::IsNullOrWhiteSpace($AdminToken)) {
    $AdminToken = Get-TokenFromLogin -UserName $AdminUser -Password $AdminPass
  }
  if ([string]::IsNullOrWhiteSpace($UserToken) -and -not [string]::IsNullOrWhiteSpace($UserUser)) {
    $UserToken = Get-TokenFromLogin -UserName $UserUser -Password $UserPass
  }
}

# 2) Admin auth smoke
if (-not [string]::IsNullOrWhiteSpace($AdminToken)) {
  $adminHeaders = @{ Authorization = "Bearer $AdminToken" }
  $me = Invoke-Http -Method "GET" -Url "$BaseUrl/api/auth/me" -Headers $adminHeaders
  if ($me.Status -eq 200) {
    Add-Result -Check "GET /api/auth/me (admin token)" -Expected "HTTP 200" -Actual "HTTP $($me.Status)" -Status "PASS"
  } else {
    Add-Result -Check "GET /api/auth/me (admin token)" -Expected "HTTP 200" -Actual "HTTP $($me.Status)" -Status "FAIL" -Note $me.Content
  }

  $adminList = Invoke-Http -Method "GET" -Url "$BaseUrl/api/user/fetchall" -Headers $adminHeaders
  if ($adminList.Status -eq 200) {
    Add-Result -Check "GET /api/user/fetchall (admin)" -Expected "HTTP 200" -Actual "HTTP $($adminList.Status)" -Status "PASS"
  } else {
    Add-Result -Check "GET /api/user/fetchall (admin)" -Expected "HTTP 200" -Actual "HTTP $($adminList.Status)" -Status "FAIL" -Note $adminList.Content
  }
} else {
  Add-Result -Check "Admin token" -Expected "Token available" -Actual "Missing" -Status "SKIP" -Note "Provide -AdminToken or -AdminUser/-AdminPass"
}

# 3) Authorization checks with non-admin token
if (-not $SkipAuthorizationChecks) {
  if (-not [string]::IsNullOrWhiteSpace($UserToken)) {
    $userHeaders = @{ Authorization = "Bearer $UserToken" }

    $checks = @(
      @{ Name = "GET /api/user/fetchall (user)"; Method = "GET"; Url = "$BaseUrl/api/user/fetchall"; Body = $null; Expected = 403 },
      @{ Name = "GET /api/transaction/admin/export (user)"; Method = "GET"; Url = "$BaseUrl/api/transaction/admin/export"; Body = $null; Expected = 403 },
      @{ Name = "POST /api/v1/finance/optimal-sum (user)"; Method = "POST"; Url = "$BaseUrl/api/v1/finance/optimal-sum"; Body = @{ moneyList = @(10000, 20000, 30000); minTarget = 10000; maxTarget = 40000; count = 2 }; Expected = 403 }
    )

    foreach ($c in $checks) {
      $resp = Invoke-Http -Method $c.Method -Url $c.Url -Headers $userHeaders -Body $c.Body
      if ($resp.Status -eq $c.Expected) {
        Add-Result -Check $c.Name -Expected "HTTP $($c.Expected)" -Actual "HTTP $($resp.Status)" -Status "PASS"
      } else {
        Add-Result -Check $c.Name -Expected "HTTP $($c.Expected)" -Actual "HTTP $($resp.Status)" -Status "FAIL" -Note $resp.Content
      }
    }
  } else {
    Add-Result -Check "User token" -Expected "Token available for authorization checks" -Actual "Missing" -Status "SKIP" -Note "Provide -UserToken or -UserUser/-UserPass"
  }
}

$passCount = ($Results | Where-Object { $_.Status -eq "PASS" }).Count
$failCount = ($Results | Where-Object { $_.Status -eq "FAIL" }).Count
$skipCount = ($Results | Where-Object { $_.Status -eq "SKIP" }).Count

Write-Host ""
Write-Host "=== Smoke Check Result ==="
$Results | Format-Table -AutoSize
Write-Host ""
Write-Host ("Summary: PASS={0} FAIL={1} SKIP={2}" -f $passCount, $failCount, $skipCount)

if ($failCount -gt 0) {
  exit 1
}
exit 0

