package app.weareradio.tv

import android.annotation.SuppressLint
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * We Are Radio on Fire TV (handoff_tv_firetv.md, Part B): one full-screen
 * WebView showing https://weareradio.app/tv?shell=firetv. Everything the
 * listener sees is the web app; this shell only adds what a web page can't do
 * on a TV: the remote's Back and media keys, keeping the screen on while
 * playing, an offline screen, and surviving a renderer crash.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var container: FrameLayout
    private lateinit var splash: View
    private var webView: WebView? = null
    private val main = Handler(Looper.getMainLooper())
    private var offlineShowing = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val home = "weareradio.app"

    /** The TV page. Debug builds can point elsewhere: adb shell am start -n app.weareradio.tv/.MainActivity --es url <url> */
    private val startUrl: String by lazy {
        val override = if (BuildConfig.DEBUG) intent?.getStringExtra("url") else null
        override ?: "https://$home/tv?shell=firetv&v=${BuildConfig.VERSION_NAME}"
    }
    private val allowedHost: String by lazy { Uri.parse(startUrl).host ?: home }

    private val retryOffline = object : Runnable {
        override fun run() {
            if (!offlineShowing) return
            if (isOnline()) loadTv() else main.postDelayed(this, RETRY_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        container = findViewById(R.id.web_container)
        splash = findViewById(R.id.splash)
        hideSystemBars()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptCookie(true)
        createWebView()
        watchNetwork()
        if (isOnline()) loadTv() else showOffline()
        // The splash never stays longer than 8 s, ready or not.
        main.postDelayed({ hideSplash() }, SPLASH_MAX_MS)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val wv = WebView(this)
        wv.setBackgroundColor(Color.parseColor("#08080a"))
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            // The page scales itself to the screen (a fixed 1920x1080 stage).
            loadWithOverviewMode = false
            useWideViewPort = false
            userAgentString = "$userAgentString WeAreRadioTV/${BuildConfig.VERSION_NAME} (FireTV)"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, false)
        wv.addJavascriptInterface(NativeBridge(this), "WeAreRadioNative")
        wv.webViewClient = object : WebViewClient() {
            // Stay on We Are Radio: there's no browser to hand other links to on Fire TV.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val ok = (url.scheme == "https" && url.host == allowedHost) || url.toString().startsWith(OFFLINE_URL)
                return !ok
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame && !request.url.toString().startsWith(OFFLINE_URL)) showOffline()
            }

            // The page's renderer was killed (low memory): start a fresh WebView rather than crash.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                container.removeView(view)
                view.destroy()
                webView = null
                createWebView()
                if (isOnline()) loadTv() else showOffline()
                return true
            }
        }
        container.addView(wv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        wv.requestFocus()
        webView = wv
    }

    private fun loadTv() {
        offlineShowing = false
        main.removeCallbacks(retryOffline)
        webView?.loadUrl(startUrl)
    }

    private fun showOffline() {
        if (offlineShowing) return
        offlineShowing = true
        hideSplash()
        webView?.loadUrl(OFFLINE_URL)
        main.removeCallbacks(retryOffline)
        main.postDelayed(retryOffline, RETRY_MS)
    }

    fun retryFromOffline() = main.post { if (isOnline()) loadTv() }

    private fun isOnline(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** The network coming back reloads straight away, without waiting for the next 15 s retry. */
    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post { if (offlineShowing) loadTv() }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(cb)
            networkCallback = cb
        } catch (_: Exception) {
            // Not available on this device: the 15 s retry still covers it.
        }
    }

    // ---- the remote ----

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) onBackKey()
            return true
        }
        val media = when (code) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "playpause"
            KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
            KeyEvent.KEYCODE_MEDIA_REWIND -> "rewind"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "fastforward"
            KeyEvent.KEYCODE_MENU -> "menu"
            else -> null
        }
        if (media != null) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 && !offlineShowing) {
                webView?.evaluateJavascript("window.weAreRadioTv && window.weAreRadioTv.media('$media')", null)
            }
            return true
        }
        // D-pad and Enter go to the page unchanged.
        return super.dispatchKeyEvent(event)
    }

    /**
     * Back asks the page first: it closes an overlay or goes back a screen and
     * answers "handled", or answers "exit" on Home. No answer within 500 ms, or
     * no page, exits: the user is never trapped.
     */
    private fun onBackKey() {
        val wv = webView
        if (wv == null || offlineShowing) {
            finish()
            return
        }
        var answered = false
        val timeout = Runnable { if (!answered) finish() }
        main.postDelayed(timeout, BACK_TIMEOUT_MS)
        wv.evaluateJavascript("window.weAreRadioTv ? window.weAreRadioTv.back() : null") { result ->
            answered = true
            main.removeCallbacks(timeout)
            if (result == null || result == "null" || result == "\"exit\"") finish()
        }
    }

    // ---- called by the page (NativeBridge), from a background thread ----

    fun setKeepScreenOn(on: Boolean) = main.post {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun exitFromPage() = main.post { finish() }

    fun hideSplash() = main.post {
        if (splash.visibility == View.VISIBLE) splash.animate().alpha(0f).setDuration(250).withEndAction { splash.visibility = View.GONE }.start()
    }

    // ---- lifecycle: TV listening is foreground only in v1 ----

    override fun onPause() {
        // Pause the station explicitly, then the WebView (the page also pauses on visibilitychange).
        webView?.evaluateJavascript("window.weAreRadioTv && window.weAreRadioTv.media('pause')", null)
        webView?.onPause()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        CookieManager.getInstance().flush() // the Like cookie survives a relaunch
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        webView?.onResume()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        networkCallback?.let {
            try {
                getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it)
            } catch (_: Exception) {
            }
        }
        webView?.let {
            container.removeView(it)
            it.destroy()
        }
        webView = null
        super.onDestroy()
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    companion object {
        private const val OFFLINE_URL = "file:///android_asset/offline.html"
        private const val RETRY_MS = 15_000L
        private const val SPLASH_MAX_MS = 8_000L
        private const val BACK_TIMEOUT_MS = 500L
    }
}
