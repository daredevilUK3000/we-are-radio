package app.weareradio.tv

import android.util.Log
import android.webkit.JavascriptInterface

/**
 * window.WeAreRadioNative: what the page (/tv, and the bundled offline screen)
 * can ask of the app. The contract is app/src/tv/nativeBridge.ts in the web app.
 * JavaScript calls arrive on a background thread; everything that touches the
 * UI hops to the main thread inside MainActivity.
 */
class NativeBridge(private val activity: MainActivity) {

    /** Keep the TV awake while the station plays; release it on pause so the screensaver can start. */
    @JavascriptInterface
    fun keepScreenOn(on: Boolean) = activity.setKeepScreenOn(on)

    /** Back pressed on Home. */
    @JavascriptInterface
    fun exitApp() = activity.exitFromPage()

    /** The page has mounted: hide the native splash. */
    @JavascriptInterface
    fun shellReady() = activity.hideSplash()

    /** Debug builds only. */
    @JavascriptInterface
    fun log(level: String, message: String) {
        if (BuildConfig.DEBUG) Log.println(if (level == "error") Log.ERROR else if (level == "warn") Log.WARN else Log.INFO, "WeAreRadio", message)
    }

    /** "Try again" on the bundled offline screen. */
    @JavascriptInterface
    fun retry() = activity.retryFromOffline()
}
