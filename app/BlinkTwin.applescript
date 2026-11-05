-- BlinkTwin launcher: starts the local site if it is not running and opens it in its own window.
set siteUrl to "http://localhost:5174"
set webDir to "/Users/utsav/Desktop/BlinkTwin/web"
set envPath to "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin; "

on isUp(u)
	try
		do shell script "curl -s -o /dev/null --max-time 2 " & u
		return true
	on error
		return false
	end try
end isUp

if not isUp(siteUrl) then
	display notification "Starting your digital twin…" with title "BlinkTwin"
	do shell script envPath & "cd " & quoted form of webDir & " && (node scripts/copy-wasm.mjs; node scripts/fetch-model.mjs) > /dev/null 2>&1; nohup ./node_modules/.bin/vite --port 5174 --strictPort > \"$HOME/Library/Logs/BlinkTwin.log\" 2>&1 &"
	repeat 60 times
		if isUp(siteUrl) then exit repeat
		delay 0.5
	end repeat
end if

if isUp(siteUrl) then
	do shell script "open -na 'Google Chrome' --args --app=" & siteUrl & " --window-size=1360,900"
else
	display dialog "BlinkTwin could not start." & return & return & "See ~/Library/Logs/BlinkTwin.log for details." buttons {"OK"} default button 1 with icon caution with title "BlinkTwin"
end if
