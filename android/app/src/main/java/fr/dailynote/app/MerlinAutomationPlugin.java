package fr.dailynote.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityManager;
import android.accessibilityservice.AccessibilityServiceInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

@CapacitorPlugin(name = "MerlinAutomation")
public class MerlinAutomationPlugin extends Plugin {
    @PluginMethod
    public void openApp(PluginCall call) {
        String packageName = call.getString("packageName");
        if (TextUtils.isEmpty(packageName)) {
            call.reject("packageName requis");
            return;
        }

        PackageManager pm = getContext().getPackageManager();
        Intent launch = pm.getLaunchIntentForPackage(packageName);
        if (launch == null) {
            call.reject("Application introuvable : " + packageName);
            return;
        }

        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(launch);
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (ActivityNotFoundException e) {
            call.reject("Impossible d'ouvrir " + packageName, e);
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (TextUtils.isEmpty(url)) {
            call.reject("url requis");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (ActivityNotFoundException e) {
            call.reject("Aucune application pour ouvrir : " + url, e);
        }
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text");
        if (TextUtils.isEmpty(text)) {
            call.reject("text requis");
            return;
        }

        String packageName = call.getString("packageName");
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("text/plain");
        intent.putExtra(Intent.EXTRA_TEXT, text);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        if (!TextUtils.isEmpty(packageName)) {
            PackageManager pm = getContext().getPackageManager();
            intent.setPackage(packageName);
            if (intent.resolveActivity(pm) == null) {
                call.reject("Application introuvable pour le partage : " + packageName);
                return;
            }
        } else {
            intent = Intent.createChooser(intent, "Partager via Merlin");
        }

        try {
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (ActivityNotFoundException e) {
            call.reject("Impossible de partager le texte", e);
        }
    }

    @PluginMethod
    public void isAccessibilityEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", isMerlinAccessibilityActive(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void performTapSequence(PluginCall call) {
        String stepsJson = call.getString("stepsJson");
        if (TextUtils.isEmpty(stepsJson)) {
            call.reject("stepsJson requis");
            return;
        }

        if (!isMerlinAccessibilityActive(getContext())) {
            call.reject("Activez le service d'accessibilité Merlin dans les réglages Android.");
            return;
        }

        MerlinAutomationService service = MerlinAutomationService.getInstance();
        if (service == null) {
            call.reject("Service d'accessibilité Merlin non connecté. Réactivez-le dans les réglages.");
            return;
        }

        getBridge()
            .execute(
                () -> {
                    String error = service.performSteps(stepsJson);
                    if (error != null) {
                        call.reject(error);
                        return;
                    }
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    call.resolve(result);
                }
            );
    }

    static boolean isMerlinAccessibilityActive(Context context) {
        AccessibilityManager am =
            (AccessibilityManager) context.getSystemService(Context.ACCESSIBILITY_SERVICE);
        if (am == null) {
            return false;
        }

        List<AccessibilityServiceInfo> services =
            am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
        if (services == null) {
            return false;
        }

        String expectedId = context.getPackageName() + "/" + MerlinAutomationService.class.getName();
        for (AccessibilityServiceInfo info : services) {
            if (info.getId() != null && info.getId().equals(expectedId)) {
                return true;
            }
        }
        return false;
    }
}
