# Theia Tunnel — proxy HTTP saliente vía Netlify+Theia.
#
# Carga:    . .\theia-tunnel.ps1
# Config:   Set-TunnelConfig -BaseUrl 'https://enviromentfree.netlify.app' -ClientToken '11f8...'
#           (o exporta $env:THEIA_TUNNEL_URL y $env:THEIA_TUNNEL_TOKEN y luego: Set-TunnelConfig)
#
# Funciones expuestas:
#   Set-TunnelConfig
#   Invoke-Proxy   — petición HTTP genérica
#   Send-OpenAI    — atajo a chat completions
#   Send-Anthropic — atajo a /v1/messages

$script:TheiaTunnel = @{
  BaseUrl     = $null
  ClientToken = $null
}

function Set-TunnelConfig {
  param(
    [string]$BaseUrl     = $env:THEIA_TUNNEL_URL,
    [string]$ClientToken = $env:THEIA_TUNNEL_TOKEN
  )
  if (-not $BaseUrl)     { throw 'Falta -BaseUrl o $env:THEIA_TUNNEL_URL' }
  if (-not $ClientToken) { throw 'Falta -ClientToken o $env:THEIA_TUNNEL_TOKEN' }
  $script:TheiaTunnel.BaseUrl     = $BaseUrl.TrimEnd('/')
  $script:TheiaTunnel.ClientToken = $ClientToken
  "Tunnel configurado: $($script:TheiaTunnel.BaseUrl)"
}

function Invoke-Proxy {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Url,
    [string]$Method = 'GET',
    [hashtable]$Headers,
    $Body,
    [int]$TimeoutMs = 25000
  )

  if (-not $script:TheiaTunnel.BaseUrl) {
    throw 'Llama primero a Set-TunnelConfig'
  }

  $payload = @{
    url       = $Url
    method    = $Method.ToUpper()
    timeoutMs = $TimeoutMs
  }
  if ($Headers) { $payload.headers = $Headers }
  if ($PSBoundParameters.ContainsKey('Body')) { $payload.body = $Body }

  $params = @{
    Method      = 'Post'
    Uri         = "$($script:TheiaTunnel.BaseUrl)/api/proxy"
    Headers     = @{ Authorization = "Bearer $($script:TheiaTunnel.ClientToken)" }
    ContentType = 'application/json'
    Body        = ($payload | ConvertTo-Json -Depth 20 -Compress)
  }
  $resp = Invoke-RestMethod @params

  if ($resp.status -ne 'done') {
    throw "Proxy job no terminó: status=$($resp.status) message=$($resp.message)"
  }
  if ($resp.error) {
    throw "Proxy error: $($resp.error)"
  }
  return $resp.response
}

function Send-OpenAI {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Prompt,
    [string]$Model = 'gpt-4o-mini',
    [string]$System,
    [int]$MaxTokens
  )
  $messages = @()
  if ($System) { $messages += @{ role = 'system'; content = $System } }
  $messages += @{ role = 'user'; content = $Prompt }

  $body = @{ model = $Model; messages = $messages }
  if ($MaxTokens) { $body.max_tokens = $MaxTokens }

  $resp = Invoke-Proxy -Url 'https://api.openai.com/v1/chat/completions' `
                       -Method POST -Body $body
  return $resp.body.choices[0].message.content
}

function Send-Anthropic {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Prompt,
    [string]$Model = 'claude-haiku-4-5-20251001',
    [int]$MaxTokens = 1024,
    [string]$System
  )
  $body = @{
    model      = $Model
    max_tokens = $MaxTokens
    messages   = @(@{ role = 'user'; content = $Prompt })
  }
  if ($System) { $body.system = $System }

  $resp = Invoke-Proxy -Url 'https://api.anthropic.com/v1/messages' `
                       -Method POST -Body $body
  return $resp.body.content[0].text
}
