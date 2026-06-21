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
        Intent intent = new Intent(getContext(), MerlinListenService.class);
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
        call.resolve(result);
    }

    @PluginMethod
    public void watchAgentJob(PluginCall call) {
        String jobId = call.getString("jobId");
        String pollUrl = call.getString("pollUrl");
        if (jobId == null || jobId.isEmpty() || pollUrl == null || pollUrl.isEmpty()) {
            call.reject("Missing jobId or pollUrl");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "agentWatchNotificationCallback");
            return;
        }
        startAgentJobWatch(call, jobId, pollUrl);
    }

    @PermissionCallback
    private void agentWatchNotificationCallback(PluginCall call) {
        String jobId = call.getString("jobId");
        String pollUrl = call.getString("pollUrl");
        if (jobId == null || jobId.isEmpty() || pollUrl == null || pollUrl.isEmpty()) {
            call.reject("Missing jobId or pollUrl");
            return;
        }
        startAgentJobWatch(call, jobId, pollUrl);
    }

    private void startAgentJobWatch(PluginCall call, String jobId, String pollUrl) {
        Intent intent = new Intent(getContext(), MerlinAgentJobService.class);
        intent.putExtra(MerlinAgentJobService.EXTRA_JOB_ID, jobId);
        intent.putExtra(MerlinAgentJobService.EXTRA_POLL_URL, pollUrl);
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
    public void stopAgentJobWatch(PluginCall call) {
        Intent intent = new Intent(getContext(), MerlinAgentJobService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}
