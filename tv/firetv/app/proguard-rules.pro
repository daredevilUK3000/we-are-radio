# The page calls these methods by name through window.WeAreRadioNative: R8 must keep them.
-keepclassmembers class app.weareradio.tv.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
