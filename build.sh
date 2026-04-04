#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
#  RemoteAccess — Single APK build script
#  Produces: apk-output/RemoteAccess-debug.apk
# ─────────────────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ANDROID_SDK_DIR="/tmp/android-sdk"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
CMDLINE_TOOLS_ZIP="/tmp/cmdline-tools.zip"
ZULU_JDK="/nix/store/0zjj9k6wz5hl4jizcfrkr0i4l8q45v51-zulu-ca-jdk-17.0.8.1"

# ── 0. Clean previous build artifacts ────────────────────────────────────────
echo "==> Cleaning previous build artifacts..."
rm -f "$ROOT_DIR"/apk-output/*.apk
rm -rf "$ROOT_DIR/app/build"
echo "  Removed apk-output/*.apk and app/build/"

# ── 1. Java ───────────────────────────────────────────────────────────────────
echo "==> Configuring Java..."
if [ -d "$ZULU_JDK" ]; then
    export JAVA_HOME="$ZULU_JDK"
    echo "  Using Zulu JDK 17 at $JAVA_HOME"
else
    export JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(which java)")")")"
    echo "  Using system Java at $JAVA_HOME"
fi
export PATH="$JAVA_HOME/bin:$PATH"
java -version 2>&1 | sed 's/^/    /'

# ── 2. Android SDK command-line tools ─────────────────────────────────────────
echo ""
echo "==> Setting up Android SDK..."
if [ ! -f "$ANDROID_SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
    echo "  Downloading command-line tools..."
    curl -fsSL "$CMDLINE_TOOLS_URL" -o "$CMDLINE_TOOLS_ZIP"
    mkdir -p /tmp/android-sdk-temp
    cd /tmp/android-sdk-temp
    jar xf "$CMDLINE_TOOLS_ZIP"
    mkdir -p "$ANDROID_SDK_DIR/cmdline-tools"
    mv /tmp/android-sdk-temp/cmdline-tools "$ANDROID_SDK_DIR/cmdline-tools/latest"
    cd "$ROOT_DIR"
    chmod +x "$ANDROID_SDK_DIR/cmdline-tools/latest/bin/sdkmanager"
    echo "  Command-line tools ready."
else
    echo "  Command-line tools already present."
fi

export ANDROID_HOME="$ANDROID_SDK_DIR"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# ── 3. SDK licenses ───────────────────────────────────────────────────────────
echo ""
echo "==> Accepting SDK licenses..."
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses > /dev/null 2>&1 || true

# ── 4. SDK platform & build-tools ─────────────────────────────────────────────
echo ""
echo "==> Installing SDK components..."
MISSING=0
[ ! -d "$ANDROID_SDK_DIR/platforms/android-36" ] && MISSING=1
[ ! -d "$ANDROID_SDK_DIR/build-tools/35.0.0"  ] && MISSING=1
if [ "$MISSING" -eq 1 ]; then
    sdkmanager --sdk_root="$ANDROID_HOME" "platforms;android-36" "build-tools;35.0.0"
    echo "  Installed: platforms;android-36 + build-tools;35.0.0"
else
    echo "  Already installed: platforms;android-36 + build-tools;35.0.0"
fi

# ── 5. Project config files ───────────────────────────────────────────────────
echo ""
echo "==> Writing project config..."

cat > "$ROOT_DIR/local.properties" <<EOF
sdk.dir=$ANDROID_SDK_DIR
EOF

cat > "$ROOT_DIR/gradle.properties" <<EOF
android.useAndroidX=true
android.enableJetifier=true
android.suppressUnsupportedCompileSdk=36
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
org.gradle.daemon=false
EOF

echo "  local.properties  — sdk.dir=$ANDROID_SDK_DIR"
echo "  gradle.properties — AndroidX + Jetifier + suppressUnsupportedCompileSdk"

# ── 6. Gradle wrapper JAR ─────────────────────────────────────────────────────
echo ""
echo "==> Checking Gradle wrapper..."
WRAPPER_JAR="$ROOT_DIR/gradle/wrapper/gradle-wrapper.jar"
if [ ! -f "$WRAPPER_JAR" ]; then
    echo "  Downloading gradle-wrapper.jar..."
    mkdir -p "$ROOT_DIR/gradle/wrapper"
    curl -fsSL "https://github.com/gradle/gradle/raw/v8.7.0/gradle/wrapper/gradle-wrapper.jar" \
        -o "$WRAPPER_JAR"
    echo "  Downloaded."
else
    echo "  Already present."
fi
chmod +x "$ROOT_DIR/gradlew"

# ── 7. Build ──────────────────────────────────────────────────────────────────
echo ""
echo "==> Building APK..."
cd "$ROOT_DIR"
./gradlew assembleDebug --no-daemon

# ── 8. Copy output ────────────────────────────────────────────────────────────
mkdir -p "$ROOT_DIR/apk-output"
cp "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk" \
   "$ROOT_DIR/apk-output/RemoteAccess-debug.apk"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BUILD COMPLETE"
echo "  APK: apk-output/RemoteAccess-debug.apk"
ls -lh "$ROOT_DIR/apk-output/RemoteAccess-debug.apk" | awk '{print "  Size: "$5}'
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
