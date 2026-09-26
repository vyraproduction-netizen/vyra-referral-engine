Option Explicit

Dim shell
Dim fileSystem
Dim scriptDirectory
Dim recoveryScript
Dim command
Dim exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)

recoveryScript = scriptDirectory & _
  "\ensure-local-edge-runtime.ps1"

command = _
  "powershell.exe -NoProfile -NonInteractive " & _
  "-ExecutionPolicy Bypass -File """ & _
  recoveryScript & """ -Repair"

If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "watchdog" Then
    command = command & " -Watchdog"
  Else
    WScript.Quit 87
  End If
End If

exitCode = shell.Run(command, 0, True)

WScript.Quit exitCode