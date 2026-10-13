package expo.modules.skopjeparkingwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SkopjeParkingWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SkopjeParkingWidget")

    AsyncFunction("update") { state: String ->
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction false
      context.getSharedPreferences(ParkingWidgetProvider.PREFERENCES, Context.MODE_PRIVATE).edit()
        .putString(ParkingWidgetProvider.STATE, state).apply()
      val ids = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, ParkingWidgetProvider::class.java))
      if (ids.isEmpty()) return@AsyncFunction false
      context.sendBroadcast(Intent(context, ParkingWidgetProvider::class.java)
        .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids))
      true
    }
  }
}
