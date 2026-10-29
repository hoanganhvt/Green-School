param(
    [Parameter(Mandatory = $true)][string]$Port,
    [string]$Config = (Join-Path $PSScriptRoot 'bin_config.json'),
    [ValidateSet('plastic', 'metal')][string]$Sensor1Type = 'plastic',
    [ValidateSet('plastic', 'metal')][string]$Sensor2Type = 'metal'
)
# Compatibility launcher: the Python bridge sends HTTPS using bin_config.json.
$ErrorActionPreference = 'Stop'
& py (Join-Path $PSScriptRoot 'firebase_http_bridge.py') --port $Port --config $Config --sensor1 $Sensor1Type --sensor2 $Sensor2Type
exit $LASTEXITCODE
