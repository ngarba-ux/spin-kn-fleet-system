@echo off
rem One-time setup so phones and other computers on the office network can
rem reach SPIN-KN Fleet. Must run as Administrator (it asks automatically).
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
set PORT=3000
echo Reserving http://+:%PORT%/ for SPIN-KN Fleet...
netsh http add urlacl url=http://+:%PORT%/ sddl=D:(A;;GX;;;WD)
echo Allowing port %PORT% through Windows Firewall (private/domain networks)...
netsh advfirewall firewall add rule name="SPIN-KN Fleet" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain
echo.
echo Done. Restart start-server.bat - it will now show the network address to use on phones.
pause
