Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-60)} -MaxEvents 30 2>$null |
  Where-Object { $_.Message -match 'personas' -or $_.Message -match 'Faulting' -or $_.Id -eq 1000 -or $_.Id -eq 1001 } |
  ForEach-Object {
    Write-Output "--- Event $($_.Id) at $($_.TimeCreated) ---"
    Write-Output $_.Message
    Write-Output ""
  }
