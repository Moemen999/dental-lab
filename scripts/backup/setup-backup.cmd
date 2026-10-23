@echo off
rem Double-click to set up the Dolphin lab backup (runs setup-backup.ps1).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-backup.ps1" %*
