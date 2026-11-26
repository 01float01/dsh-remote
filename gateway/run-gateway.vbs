' ===========================================================================
'  DSH Remote — gateway launcher.
'
'  Double-click to start the gateway in a visible console (it prints the access
'  URL, the password and a scannable QR code). No .bat file is used on purpose:
'  some Chinese AV suites (e.g. 360) flag .bat launches from Explorer.
'
'  Everything is resolved relative to this file, so the repository can live
'  anywhere. Override the interpreter with DSH_GATE_NODE if `pwsh` is not what
'  you want.
' ===========================================================================
Option Explicit
Dim shell, fso, here, ps1, cmd
Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(here, "start-gateway.ps1")
If Not fso.FileExists(ps1) Then
  MsgBox "Launcher not found:" & vbCrLf & ps1, 16, "DSH Remote"
  WScript.Quit 1
End If
cmd = "pwsh.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File """ & ps1 & """"
On Error Resume Next
shell.Run cmd, 1, False
If Err.Number <> 0 Then
  ' Windows PowerShell 5.1 ships with every Windows box; pwsh may not be present.
  Err.Clear
  cmd = "powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File """ & ps1 & """"
  shell.Run cmd, 1, False
  If Err.Number <> 0 Then
    MsgBox "Failed to start gateway:" & vbCrLf & Err.Description, 16, "DSH Remote"
    WScript.Quit 1
  End If
End If
On Error GoTo 0
WScript.Quit 0
