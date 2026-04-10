# Android Development Setup — ARM64 Windows (Snapdragon X Elite)

> Machine: Snapdragon X Elite, 64GB RAM, 525GB free, Windows 11 ARM64
> Hypervisor: Running (Hyper-V detected)

## Quick summary

Your ARM64 Windows machine is **ideal for Android development** because Android
phones also run ARM. You can either use a physical phone (best) or ARM64 Android
emulator images (good, near-native speed).

## Step 1: Install Android SDK (command-line only, no Android Studio needed)

```powershell
# Download Android command-line tools (Windows ARM64 compatible)
# From: https://developer.android.com/studio#command-line-tools-only

# Create SDK directory
mkdir $env:LOCALAPPDATA\Android\Sdk

# Download and extract cmdline-tools
# (Use browser to download latest from the link above, or:)
curl -L -o cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
Expand-Archive cmdline-tools.zip -DestinationPath $env:LOCALAPPDATA\Android\Sdk\cmdline-tools
# Rename to "latest" (required by sdkmanager)
Rename-Item $env:LOCALAPPDATA\Android\Sdk\cmdline-tools\cmdline-tools $env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest
Remove-Item cmdline-tools.zip
```

## Step 2: Set environment variables

Add to your system/user environment variables (Settings > System > Advanced > Environment Variables):

```
ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk
JAVA_HOME    = %LOCALAPPDATA%\Android\Sdk\jbr    (bundled JDK, installed in step 3)
```

Add to PATH:
```
%ANDROID_HOME%\cmdline-tools\latest\bin
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\emulator
```

Or set them in your shell profile:
```bash
# ~/.bashrc or ~/.bash_profile
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

## Step 3: Install SDK components

```bash
# Accept licenses
sdkmanager --licenses

# Install required components
sdkmanager "platforms;android-34"           # Android 14 API
sdkmanager "build-tools;34.0.0"            # Build tools
sdkmanager "platform-tools"                 # adb, fastboot
sdkmanager "ndk;25.2.9519653"              # NDK for Rust cross-compilation

# For emulator (ARM64 system image — fast on your ARM CPU):
sdkmanager "emulator"
sdkmanager "system-images;android-34;google_apis;arm64-v8a"
```

**Note:** The `arm64-v8a` system image runs at near-native speed on your
Snapdragon X Elite because both are ARM64. No x86 emulation needed.

## Step 4: Install JDK

Android SDK needs JDK 17+. Easiest option:

```bash
# Option A: Via sdkmanager (bundled JBR)
# Already included if you installed Android Studio, otherwise:
winget install -e --id EclipseAdoptium.Temurin.17.JDK

# Verify
java -version
```

## Step 5: Rust Android targets

```bash
# Add ARM Android targets (primary — matches your phone and emulator)
rustup target add aarch64-linux-android

# Optional: add x86_64 for emulator compatibility
rustup target add x86_64-linux-android

# Verify
rustup target list --installed | grep android
```

## Step 6: Tauri CLI

```bash
# Install Tauri CLI v2
cargo install tauri-cli --version "^2"

# Verify
cargo tauri --version
```

## Step 7: Initialize Android project

```bash
cd C:/Users/mkdol/dolla/personas

# Scaffold Android project
npx tauri android init
```

This creates `src-tauri/gen/android/` with the Gradle project structure.

## Testing options (ranked by recommendation)

### Option A: Physical Android phone (BEST)

Requirements: Any Android phone + USB-C cable

```bash
# 1. Enable Developer Options on phone:
#    Settings > About Phone > tap "Build Number" 7 times
#
# 2. Enable USB Debugging:
#    Settings > Developer Options > USB Debugging > ON
#
# 3. Connect phone via USB-C

# 4. Verify connection
adb devices
# Should show your device

# 5. Run the app on phone
npx tauri android dev
```

This deploys the debug APK directly to your phone. Hot-reload works — change
React code and it updates live on the phone.

**Why this is best:** Real hardware, real performance, real touch input. No
emulation overhead. The Snapdragon in your PC and the Snapdragon in most
Android phones share the same ARM architecture.

### Option B: ARM64 Android emulator (GOOD)

```bash
# Create an AVD (Android Virtual Device) with ARM64 image
avdmanager create avd \
  --name "Pixel_7_API_34" \
  --package "system-images;android-34;google_apis;arm64-v8a" \
  --device "pixel_7"

# Launch emulator
emulator -avd Pixel_7_API_34

# In another terminal, run the app
npx tauri android dev
```

**Performance on your machine:** ARM64 image on ARM64 host = near-native speed.
The 64GB RAM means you can run the emulator comfortably alongside dev tools.

**Note:** First launch downloads ~2GB of system image data and takes a few
minutes. Subsequent launches are fast (~10-15 seconds).

### Option C: ADB over Wi-Fi (no cable needed)

If phone and PC are on the same network:

```bash
# 1. Connect phone via USB first
adb devices

# 2. Enable wireless debugging
adb tcpip 5555

# 3. Get phone's IP (Settings > Wi-Fi > your network > IP address)
adb connect 192.168.x.x:5555

# 4. Disconnect USB cable — now wireless
adb devices  # should show IP:5555

# 5. Run
npx tauri android dev
```

## Verifying the build without running

If you just want to build the APK and inspect it without running:

```bash
# Build debug APK
npx tauri android build --debug

# Output location:
# src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk

# Inspect APK contents (optional)
# Install apktool or just unzip — APK is a zip file
unzip -l src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

You can also drag-drop the APK onto a connected phone to install it manually.

## Troubleshooting

### "SDK location not found"
Set `ANDROID_HOME` environment variable and restart your terminal.

### "NDK not found"
```bash
sdkmanager "ndk;25.2.9519653"
# And set NDK_HOME=$ANDROID_HOME/ndk/25.2.9519653
```

### "adb: device unauthorized"
Tap "Allow" on the phone's USB debugging prompt. Check "Always allow from this
computer".

### Emulator won't start
On ARM64 Windows, you MUST use `arm64-v8a` system images. The `x86_64` images
will try to emulate x86 in software and be extremely slow or crash.

### Gradle build fails with memory errors
Your 64GB RAM is more than enough, but set Gradle JVM args if needed:
```bash
# In src-tauri/gen/android/gradle.properties
org.gradle.jvmargs=-Xmx4096m
```

## Total disk space needed

| Component | Size |
|-----------|------|
| Command-line tools | ~150 MB |
| Android SDK platform 34 | ~100 MB |
| Build tools 34.0.0 | ~250 MB |
| Platform tools (adb) | ~30 MB |
| NDK 25.2 | ~2.5 GB |
| ARM64 system image | ~1.5 GB |
| Emulator | ~500 MB |
| JDK 17 | ~300 MB |
| **Total** | **~5.5 GB** |

With 525 GB free this is not a concern.
