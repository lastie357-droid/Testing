#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
#  RemoteAccess — Build script
#  Produces:
#    apk-output/RemoteAccess-debug.apk   (debug, unobfuscated)
#    apk-output/RemoteAccess-release.apk (release, signed + heavily protected)
# ─────────────────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ANDROID_SDK_DIR="/tmp/android-sdk"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
CMDLINE_TOOLS_ZIP="/tmp/cmdline-tools.zip"
ZULU_JDK="/nix/store/0zjj9k6wz5hl4jizcfrkr0i4l8q45v51-zulu-ca-jdk-17.0.8.1"
KEYSTORE="$ROOT_DIR/app/release.keystore"
KEY_ALIAS="release"
KEY_PASS="android"
STORE_PASS="android"

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

# ── 5. Release keystore ───────────────────────────────────────────────────────
echo ""
echo "==> Checking release keystore..."
if [ ! -f "$KEYSTORE" ]; then
    echo "  Generating new release keystore..."
    keytool -genkeypair \
        -keystore "$KEYSTORE" \
        -alias "$KEY_ALIAS" \
        -keyalg RSA \
        -keysize 4096 \
        -validity 10000 \
        -storepass "$STORE_PASS" \
        -keypass "$KEY_PASS" \
        -dname "CN=RemoteAccess, OU=Mobile, O=Corp, L=City, ST=State, C=US" \
        -sigalg SHA256withRSA \
        2>&1 | sed 's/^/    /'
    echo "  Keystore created: $KEYSTORE"
else
    echo "  Keystore already present: $KEYSTORE"
fi

# ── 6. Obfuscation dictionary ─────────────────────────────────────────────────
echo ""
echo "==> Generating obfuscation dictionary..."
# Creates a dict of confusing unicode look-alike identifiers so decompiled
# output is unreadable even if the obfuscated names are extracted.
python3 - << 'PYEOF'
import random, string, os

random.seed(0xDEADBEEF)

# Generate 2000 short identifier-safe strings that look alike in most fonts
words = set()
chars = ['I', 'l', '1', 'O', '0', 'Il', 'lI', '1l', 'l1', 'II', 'll', '00', 'O0']
extra = [''.join(random.choices('IlO01', k=random.randint(3,8))) for _ in range(2000)]
words.update(extra)
# Remove pure-digit strings (not valid Java identifiers)
words = [w for w in words if not w.isdigit()]
random.shuffle(words)

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app', 'obf-dict.txt')
with open(out_path, 'w') as f:
    f.write('\n'.join(words[:1500]))
print(f"  Written {min(len(words),1500)} entries to app/obf-dict.txt")
PYEOF

# ── 7. Project config files ───────────────────────────────────────────────────
echo ""
echo "==> Writing project config..."

cat > "$ROOT_DIR/local.properties" <<EOF
sdk.dir=$ANDROID_SDK_DIR
EOF

cat > "$ROOT_DIR/gradle.properties" <<EOF
android.useAndroidX=true
android.enableJetifier=true
android.suppressUnsupportedCompileSdk=36
android.enableR8.fullMode=true
org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8
org.gradle.daemon=false
EOF

echo "  local.properties  — sdk.dir=$ANDROID_SDK_DIR"
echo "  gradle.properties — AndroidX + Jetifier + R8 full mode"

# ── 8. Gradle wrapper JAR ─────────────────────────────────────────────────────
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

# ── 9. Build debug APK ────────────────────────────────────────────────────────
echo ""
echo "==> Building DEBUG APK..."
cd "$ROOT_DIR"
./gradlew assembleDebug --no-daemon

mkdir -p "$ROOT_DIR/apk-output"
cp "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk" \
   "$ROOT_DIR/apk-output/RemoteAccess-debug.apk"

DEBUG_SIZE=$(ls -lh "$ROOT_DIR/apk-output/RemoteAccess-debug.apk" | awk '{print $5}')
echo "  Debug APK: apk-output/RemoteAccess-debug.apk ($DEBUG_SIZE)"

# ── 10. Build release APK (signed + ProGuard/R8 protected) ───────────────────
echo ""
echo "==> Building RELEASE APK (signed + R8 full-mode + ProGuard)..."
cd "$ROOT_DIR"
./gradlew assembleRelease --no-daemon

# Locate the release APK (could be aligned or unaligned)
RELEASE_SRC="$ROOT_DIR/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$RELEASE_SRC" ]; then
    RELEASE_SRC=$(find "$ROOT_DIR/app/build/outputs/apk/release" -name "*.apk" | head -1)
fi

if [ -n "$RELEASE_SRC" ] && [ -f "$RELEASE_SRC" ]; then
    cp "$RELEASE_SRC" "$ROOT_DIR/apk-output/RemoteAccess-release.apk"
    RELEASE_SIZE=$(ls -lh "$ROOT_DIR/apk-output/RemoteAccess-release.apk" | awk '{print $5}')
    echo "  Release APK: apk-output/RemoteAccess-release.apk ($RELEASE_SIZE)"
    echo ""
    echo "  Protection summary:"
    echo "    ✔ minifyEnabled    — dead code removed"
    echo "    ✔ shrinkResources  — unused resources stripped"
    echo "    ✔ R8 full mode     — maximum class/method merging + inlining"
    echo "    ✔ 7 optimization   — passes (max obfuscation depth)"
    echo "    ✔ repackageclasses — all classes flattened to package 'a'"
    echo "    ✔ Log removal      — all Log.d/i/w/e stripped from bytecode"
    echo "    ✔ Obf. dictionary  — confusing look-alike identifiers"
    echo "    ✔ RSA-4096 keystore — release signing"
else
    echo "  WARNING: Release APK not found — check build output above"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BUILD COMPLETE"
ls -lh "$ROOT_DIR/apk-output/"*.apk 2>/dev/null | awk '{print "  "$9" ("$5")"}'
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
