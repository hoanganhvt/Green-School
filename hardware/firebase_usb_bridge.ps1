param(
    [Parameter(Mandatory = $true)][string]$Port,
    [ValidatePattern('^[A-Z0-9_-]+$')][string]$BinId = 'BIN-01',
    [ValidateSet('plastic', 'metal')][string]$Sensor1Type = 'plastic',
    [ValidateSet('plastic', 'metal')][string]$Sensor2Type = 'metal',
    [string]$DeviceEmail = 'bin01@devices.greenschool.app',
    [string]$DevicePassword = 'device-demo-123'
)
$ErrorActionPreference = 'Stop'
# Local-only bridge for hardware/Green-School/Green-School.ino. No Google login, token, or cloud URL.
$databaseUrl = 'http://127.0.0.1:9000'
$namespace = 'demo-green-school-default-rtdb'
$serialPort = New-Object System.IO.Ports.SerialPort $Port, 115200, None, 8, One
$serialPort.ReadTimeout = 1000
$serialPort.DtrEnable = $false
$runId = [guid]::NewGuid().ToString('N')
$pendingEvents = New-Object System.Collections.Generic.Queue[object]
$lastHeartbeat = [datetime]::MinValue
$lastSend = [datetime]::MinValue
$deviceAuth = $null
$lastLogin = [datetime]::MinValue
try {
    $serialPort.Open()
    Write-Host "USB $Port -> local Firebase, $BinId. Sensor 1=$Sensor1Type; sensor 2=$Sensor2Type. Ctrl+C to stop."
    while ($true) {
        if ($null -eq $deviceAuth -or ([datetime]::UtcNow - $lastLogin).TotalMinutes -ge 50) {
            $login = @{ email=$DeviceEmail; password=$DevicePassword; returnSecureToken=$true } | ConvertTo-Json -Compress
            $deviceAuth = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-green-school-key' -Body $login -ContentType 'application/json' -TimeoutSec 5
            $lastLogin = [datetime]::UtcNow
        }
        try {
            $line = $serialPort.ReadLine().Trim()
            if ($line -match '^GS_DROP ([12]) ([0-9]+)$') {
                $sensor = $Matches[1]
                $counter = $Matches[2]
                $type = if ($sensor -eq '1') { $Sensor1Type } else { $Sensor2Type }
                if ($pendingEvents.Count -ge 100) {
                    Write-Warning 'Local retry queue full; dropping oldest unsent event.'
                    $pendingEvents.Dequeue() | Out-Null
                }
                # Unique even after a device reset; retain this ID when retrying a failed request.
                $txId = "USB-$runId-$([guid]::NewGuid().ToString('N'))"
                $eventBody = @{ txId=$txId; binId=$BinId; type=$type; deviceUid=$deviceAuth.localId; source='esp32'; status='pending'; ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress
                $pendingEvents.Enqueue(@{ Id=$txId; Body=$eventBody; CapturedAt=[datetime]::UtcNow })
                Write-Host "Captured sensor $sensor count $counter : $txId"
            }
        } catch [System.TimeoutException] { }
        $now = [datetime]::UtcNow
        if (($now - $lastHeartbeat).TotalSeconds -ge 30) {
            $lastHeartbeat = $now
            try {
                $beat = @{ lastSeen=@{ '.sv'='timestamp' }; ip='usb-bridge' } | ConvertTo-Json -Compress
                Invoke-RestMethod -Method Patch -Uri "$databaseUrl/bins/$BinId.json?ns=$namespace&auth=$($deviceAuth.idToken)" -Body $beat -ContentType 'application/json' -TimeoutSec 2 | Out-Null
            } catch { Write-Warning "Heartbeat failed: $($_.Exception.Message)" }
        }
        if ($pendingEvents.Count -gt 0 -and ($now - $lastSend).TotalSeconds -ge 2) {
            $lastSend = $now
            $item = $pendingEvents.Peek()
            # Do not attribute an old offline drop to a later student's session.
            if (($now - $item.CapturedAt).TotalSeconds -gt 30) {
                Write-Warning "Expired unsent event $($item.Id)"
                $pendingEvents.Dequeue() | Out-Null
                continue
            }
            try {
                $uri = "$databaseUrl/events/$($item.Id).json?ns=$namespace&auth=$($deviceAuth.idToken)"
                try {
                    # Conditional create avoids overwriting a processed event after a lost response.
                    Invoke-RestMethod -Method Put -Uri $uri -Headers @{ 'if-match'='null_etag' } -Body $item.Body -ContentType 'application/json' -TimeoutSec 2 | Out-Null
                } catch {
                    if ([int]$_.Exception.Response.StatusCode -ne 412) { throw }
                }
                $pendingEvents.Dequeue() | Out-Null
                Write-Host "Sent $($item.Id)"
            } catch { Write-Warning "Event kept for retry: $($_.Exception.Message)" }
        }
    }
} finally { if ($serialPort.IsOpen) { $serialPort.Close() }; $serialPort.Dispose() }
