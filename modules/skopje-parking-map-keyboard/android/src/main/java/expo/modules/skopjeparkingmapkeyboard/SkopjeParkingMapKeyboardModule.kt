package expo.modules.skopjeparkingmapkeyboard

import android.content.Context
import android.os.Build
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SkopjeParkingMapKeyboardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SkopjeParkingMapKeyboard")

    AsyncFunction("dismissForMap") {
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      // Evaluate focus on the UI queue, not when JS sent the map event. A user
      // may already have focused search or a sheet field by the time it arrives.
      val map = activity.currentFocus as? WebView ?: return@AsyncFunction false
      if (map.title != "Skopje Parking map") return@AsyncFunction false
      // An RN Modal owns another window while the Activity can still remember
      // this WebView as currentFocus. Never queue a hide on that inactive window.
      if (!map.hasWindowFocus() || !activity.window.decorView.hasWindowFocus()) return@AsyncFunction false
      val token = map.windowToken ?: return@AsyncFunction false

      // RN Keyboard.dismiss only knows RN TextInputs. A WebView can inherit an
      // already-visible IME without a focused HTML editor. This bundled map has
      // no text fields; keep its focus/gestures intact and hide only its IME.
      val controller = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.window.insetsController else null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && controller != null) {
        controller.hide(WindowInsets.Type.ime())
      } else {
        val keyboard = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        keyboard.hideSoftInputFromWindow(token, 0)
      }
      true
    }.runOnQueue(Queues.MAIN)
  }
}
