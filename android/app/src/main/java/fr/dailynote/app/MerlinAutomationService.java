package fr.dailynote.app;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import androidx.annotation.Nullable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

public class MerlinAutomationService extends AccessibilityService {
    private static volatile MerlinAutomationService instance;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Passive service — gestures only after explicit user confirmation in Merlin.
    }

    @Override
    public void onInterrupt() {
        // No-op
    }

    public static boolean isEnabled() {
        return instance != null;
    }

    @Nullable
    public static MerlinAutomationService getInstance() {
        return instance;
    }

    public String performSteps(String stepsJson) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return "Gestes d'accessibilité indisponibles sur cette version d'Android.";
        }

        try {
            JSONArray steps = new JSONArray(stepsJson);
            for (int i = 0; i < steps.length(); i++) {
                JSONObject step = steps.getJSONObject(i);
                String action = step.optString("action", step.optString("type", ""));
                int delayMs = step.optInt("delayMs", step.optInt("ms", 0));

                if (delayMs > 0) {
                    Thread.sleep(delayMs);
                }

                switch (action) {
                    case "click":
                    case "tap": {
                        float x = (float) step.getDouble("x");
                        float y = (float) step.getDouble("y");
                        if (!performClick(x, y)) {
                            return "Échec du tap à (" + x + ", " + y + ").";
                        }
                        break;
                    }
                    case "back":
                        if (!performGlobalAction(GLOBAL_ACTION_BACK)) {
                            return "Impossible d'effectuer Retour.";
                        }
                        break;
                    case "home":
                        if (!performGlobalAction(GLOBAL_ACTION_HOME)) {
                            return "Impossible d'aller à l'accueil.";
                        }
                        break;
                    case "delay":
                        Thread.sleep(step.optInt("ms", 500));
                        break;
                    default:
                        return "Action inconnue : " + action;
                }
            }
            return null;
        } catch (Exception e) {
            return e.getMessage() != null ? e.getMessage() : "Erreur pendant l'automatisation.";
        }
    }

    private boolean performClick(float x, float y) throws InterruptedException {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return false;
        }

        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.StrokeDescription stroke =
            new GestureDescription.StrokeDescription(path, 0, 80);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(stroke);

        CountDownLatch latch = new CountDownLatch(1);
        AtomicBoolean success = new AtomicBoolean(false);

        mainHandler.post(() -> {
            boolean dispatched =
                dispatchGesture(
                    builder.build(),
                    new GestureResultCallback() {
                        @Override
                        public void onCompleted(GestureDescription gestureDescription) {
                            success.set(true);
                            latch.countDown();
                        }

                        @Override
                        public void onCancelled(GestureDescription gestureDescription) {
                            latch.countDown();
                        }
                    },
                    null
                );
            if (!dispatched) {
                latch.countDown();
            }
        });

        boolean finished = latch.await(5, TimeUnit.SECONDS);
        return finished && success.get();
    }
}
