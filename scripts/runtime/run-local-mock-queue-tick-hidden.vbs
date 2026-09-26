Option Explicit

Dim shell, files, tickScript, powershellPath, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

tickScript = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "run-local-mock-queue-tick.ps1")
If Not files.FileExists(tickScript) Then WScript.Quit 1

powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
command = Chr(34) & powershellPath & Chr(34) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Chr(34) & tickScript & Chr(34)
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
