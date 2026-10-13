package expo.modules.skopjeparkingwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/** Current SMS zone and a Pay button. The app writes the state; this only draws it. */
class ParkingWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    manager.updateAppWidget(ids, views(context))
  }

  companion object {
    const val PREFERENCES = "skopje_parking_widget"
    const val STATE = "state"
    // Without fresh fixes the zone may be one the driver has left. Pay still asks to check the sign.
    private const val STALE_MS = 30 * 60_000L

    private fun JSONObject.text(key: String) = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

    private fun views(context: Context): RemoteViews {
      val state = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(STATE, null)
        ?.let { runCatching { JSONObject(it) }.getOrNull() }
      val fresh = state?.takeIf { System.currentTimeMillis() - it.optLong("at") in 0..STALE_MS }
      val zone = fresh?.text("zone")
      val url = fresh?.text("url")
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val views = RemoteViews(context.packageName, R.layout.skopje_parking_widget)
      launch?.let { views.setOnClickPendingIntent(android.R.id.background, activity(context, 0, it)) }
      if (fresh != null && zone != null && url != null && launch != null) {
        val detail = fresh.text("detail")
        views.setTextViewText(R.id.skopje_parking_widget_title, zone)
        views.setTextViewText(R.id.skopje_parking_widget_detail, detail ?: "")
        views.setViewVisibility(R.id.skopje_parking_widget_detail, if (detail == null) View.GONE else View.VISIBLE)
        views.setTextViewText(R.id.skopje_parking_widget_action, fresh.text("pay") ?: context.getString(R.string.skopje_parking_widget_pay))
        // Explicit component: the link opens this app's own activity, never another handler of the scheme.
        val pay = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setComponent(launch.component)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        views.setOnClickPendingIntent(R.id.skopje_parking_widget_action, activity(context, 1, pay))
      } else {
        views.setTextViewText(R.id.skopje_parking_widget_title, state?.text("empty") ?: context.getString(R.string.skopje_parking_widget_empty))
        views.setViewVisibility(R.id.skopje_parking_widget_detail, View.GONE)
        views.setTextViewText(R.id.skopje_parking_widget_action, state?.text("open") ?: context.getString(R.string.skopje_parking_widget_open))
        launch?.let { views.setOnClickPendingIntent(R.id.skopje_parking_widget_action, activity(context, 1, it)) }
      }
      return views
    }

    private fun activity(context: Context, code: Int, intent: Intent) =
      PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
