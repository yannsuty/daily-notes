package fr.dailynote.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "MerlinBackground",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class MerlinBackgroundPlugin extends Plugin {
    private static MerlinBackgroundPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
        MerlinWakeBridge.flushPendingWake();
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.handleOnDestroy();
    }

    public static MerlinBackgroundPlugin getInstance() {
        return instance;
    }

    public void emitWake(String type, String query) {
        JSObject payload = new JSObject();
        payload.put("type", type);
        payload.put("query", query != null ? query : "");
        notifyListeners("wakeDetected", payload);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermsCallback");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermsCallback");
            return;
        }
        startListenService(call);
    }

    @PermissionCallback
    private void microphonePermsCallback(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Microphone permission denied");
            return;
        }
        startListening(call);
    }

    @PermissionCallback
    private void notificationPermsCallback(PluginCall call) {
        startListening(call);
    }

    private void startListenService(PluginCall call) {
        String accessKey = call.getString("accessKey", "");
        Intent intent = new Intent(getContext(), MerlinListenService.class);
        intent.putExtra(MerlinListenService.EXTRA_ACCESS_KEY, accessKey);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        Intent intent = new Intent(getContext(), MerlinListenService.class);
        getContext().stopService(intent);
        call.resolve();
    }

    @PluginMethod
    public void isListening(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", MerlinListenService.isRunning());
        result.put("mode", MerlinListenService.getActiveMode());
        call.resolve(result);
    }
}
