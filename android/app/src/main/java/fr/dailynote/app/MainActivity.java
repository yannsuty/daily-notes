package fr.dailynote.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MerlinBackgroundPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(MerlinAutomationPlugin.class);
        super.onCreate(savedInstanceState);
        handleMerlinWakeIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleMerlinWakeIntent(intent);
    }

    private void handleMerlinWakeIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String type = intent.getStringExtra(MerlinListenService.EXTRA_WAKE_TYPE);
        if (type == null) {
            return;
        }
        String query = intent.getStringExtra(MerlinListenService.EXTRA_WAKE_QUERY);
        intent.removeExtra(MerlinListenService.EXTRA_WAKE_TYPE);
        intent.removeExtra(MerlinListenService.EXTRA_WAKE_QUERY);
        MerlinWakeBridge.deliverWake(type, query != null ? query : "");
    }
}
