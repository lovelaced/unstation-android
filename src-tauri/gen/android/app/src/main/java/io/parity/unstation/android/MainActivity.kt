package io.parity.unstation.android

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge silently disables the manifest's adjustResize (the window no longer
    // fits system windows), so the soft keyboard OVERLAYS the webview and hides whatever
    // sits beneath it — e.g. the Go Live buttons under the stream-name field. Consume the
    // IME inset ourselves: pad the content root by the keyboard height so the webview
    // shrinks above it and the page reflows/scrolls like a normal resize.
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(0, 0, 0, ime.bottom)
      insets
    }
  }
}
