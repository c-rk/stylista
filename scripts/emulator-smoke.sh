#!/bin/bash
# Installs the APK on the running emulator, launches it, and records whether it survives.
set -u
APK=$1
mkdir -p emulator-out
adb install -r "$APK"
adb logcat -c
adb shell monkey -p com.stylista.app -c android.intent.category.LAUNCHER 1
for t in 10 25 45; do
  sleep $(( t == 10 ? 10 : t == 25 ? 15 : 20 ))
  adb exec-out screencap -p > emulator-out/screen-${t}s.png
  if adb shell pidof com.stylista.app > /dev/null; then echo "ALIVE at ${t}s"; else echo "DEAD at ${t}s"; fi
done
adb logcat -d > emulator-out/logcat.txt
echo "===== crash / JS errors ====="
grep -E "AndroidRuntime|FATAL|ReactNativeJS|libc  |DEBUG   :|Abort message|com.stylista|SoLoader|UnsatisfiedLink|Exception" emulator-out/logcat.txt | grep -v "^.*I ActivityManager: Start proc" | head -150
adb shell pidof com.stylista.app > /dev/null || { echo "App is not running after launch"; exit 1; }
