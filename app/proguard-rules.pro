# ═══════════════════════════════════════════════════════════════════════════════
#  Heavy ProGuard / R8 protection rules
#  Obfuscates, shrinks, optimises, and hardens the release APK.
# ═══════════════════════════════════════════════════════════════════════════════

# ── R8 full-mode (maximum shrinking + obfuscation, enabled in gradle.properties)
# -fullmode   ← set via android.enableR8.fullMode=true in gradle.properties

# ── General optimisation passes ──────────────────────────────────────────────
-optimizationpasses 7
-optimizations !code/simplification/arithmetic,!code/simplification/cast,\
  !field/*,!class/merging/*,code/removal/simple,code/removal/advanced,\
  code/inlining/short,code/inlining/unique,class/unboxing/enum,\
  class/merging/vertical,class/merging/horizontal

# ── Package / class flattening ─────────────────────────────────────────────
-repackageclasses 'a'
-allowaccessmodification
-flattenpackagehierarchy 'a'

# ── Remove all logging (no string leakage via Log.d / Log.i / Log.w / Log.e)
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int     v(...);
    public static int     d(...);
    public static int     i(...);
    public static int     w(...);
    public static int     e(...);
    public static int     wtf(...);
    public static java.lang.String getStackTraceString(java.lang.Throwable);
}

# ── Remove System.out / err (common debug leakage vector)
-assumenosideeffects class java.io.PrintStream {
    public void println(...);
    public void print(...);
}

# ── String encryption utility (keep constructor & decode method; class itself
#    gets renamed by obfuscation so its presence is not obvious)
-keep class com.remoteaccess.educational.security.StringEncrypt {
    public static java.lang.String d(java.lang.String, int);
}

# ── Android entry-points (must keep names so the OS can find them) ──────────
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Application
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.content.ContentProvider
-keep public class * extends android.accessibilityservice.AccessibilityService
-keep public class * extends android.view.View

# ── Keep all Parcelable CREATOR fields ──────────────────────────────────────
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# ── Keep serializable classes ────────────────────────────────────────────────
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ── Keep native methods ──────────────────────────────────────────────────────
-keepclasseswithmembernames class * {
    native <methods>;
}

# ── Keep enum values (used by reflection internally) ─────────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── AndroidX / Support libraries ─────────────────────────────────────────────
-keep class androidx.** { *; }
-keep interface androidx.** { *; }
-dontwarn androidx.**

# ── OkHttp / Retrofit (networking) ──────────────────────────────────────────
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class retrofit2.** { *; }
-dontwarn retrofit2.**

# ── Socket.IO client ─────────────────────────────────────────────────────────
-keep class io.socket.** { *; }
-dontwarn io.socket.**

# ── Gson (JSON serialisation) ────────────────────────────────────────────────
-keep class com.google.gson.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn sun.misc.**
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ── WorkManager ──────────────────────────────────────────────────────────────
-keep class androidx.work.** { *; }
-dontwarn androidx.work.**

# ── Dexter (permissions) ─────────────────────────────────────────────────────
-keep class com.karumi.dexter.** { *; }
-dontwarn com.karumi.dexter.**

# ── Suppress common warnings from dependencies ───────────────────────────────
-dontwarn java.lang.invoke.**
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.**

# ── Keep R class (resource IDs must survive obfuscation) ─────────────────────
-keepclassmembers class **.R$* {
    public static <fields>;
}

# ── Obfuscation dictionary — makes decompilation output unreadable ────────────
#    app/obf-dict.txt is committed and regenerated by build.sh.
-obfuscationdictionary         obf-dict.txt
-classobfuscationdictionary    obf-dict.txt
-packageobfuscationdictionary  obf-dict.txt

# ── Extra hardening ──────────────────────────────────────────────────────────
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-dontskipnonpubliclibraryclassmembers
-verbose
