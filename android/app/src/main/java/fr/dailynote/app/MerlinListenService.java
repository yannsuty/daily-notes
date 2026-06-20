package fr.dailynote.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.TextUtils;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import ai.picovoice.porcupine.PorcupineException;
import ai.picovoice.porcupine.PorcupineManager;
import ai.picovoice.porcupine.PorcupineManagerCallback;
import fr.dailynote.app.MerlinWakeWordParser.WakeMatch;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Locale;

public class MerlinListenService extends Service implements RecognitionListener {
    public static final String EXTRA_WAKE_TYPE = "merlin_wake_type";
    public static final String EXTRA_WAKE_QUERY = "merlin_wake_query";
    public static final String EXTRA_ACCESS_KEY = "merlin_picovoice_access_key";

    private static final String CHANNEL_ID = "merlin_listen";
    private static final int NOTIFICATION_ID = 42001;
    private static final long RESTART_DELAY_MS = 600;
    private static final long POST_WAKE_STT_DELAY_MS = 250;
    private static final float PORCUPINE_SENSITIVITY = 0.65f;
    private static final String WAKEWORD_DIR = "wakeword";
    private static final String KEYWORD_ASSET = "wakeword/merlin_fr.ppn";
    private static final String MODEL_ASSET = "wakeword/porcupine_params_fr.pv";

    private enum ListenMode {
        PORCUPINE,
        LEGACY_STT
    }

    private static volatile boolean running = false;
    private static volatile ListenMode activeMode = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PorcupineManager porcupineManager;
    private SpeechRecognizer speechRecognizer;
    private ListenMode listenMode;
    private boolean shouldListen = false;
    private boolean isListening = false;
    private boolean capturingCommand = false;
    private String accessKey = "";

    public static boolean isRunning() {
        return running;
    }

    public static String getActiveMode() {
        return activeMode != null ? activeMode.name().toLowerCase(Locale.US) : "off";
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        shouldListen = true;
        if (intent != null && intent.hasExtra(EXTRA_ACCESS_KEY)) {
            accessKey = intent.getStringExtra(EXTRA_ACCESS_KEY);
        }

        Notification notification = buildNotification(
            getString(R.string.merlin_listen_title),
            getString(R.string.merlin_listen_text)
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        mainHandler.post(this::startEngine);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        shouldListen = false;
        running = false;
        activeMode = null;
        destroyPorcupine();
        destroyRecognizer();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startEngine() {
        if (!shouldListen) {
            return;
        }
        if (tryStartPorcupine()) {
            listenMode = ListenMode.PORCUPINE;
            activeMode = ListenMode.PORCUPINE;
            updateNotification(
                getString(R.string.merlin_listen_title),
                getString(R.string.merlin_listen_text_porcupine)
            );
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            stopSelf();
            return;
        }
        listenMode = ListenMode.LEGACY_STT;
        activeMode = ListenMode.LEGACY_STT;
        updateNotification(
            getString(R.string.merlin_listen_title),
            getString(R.string.merlin_listen_text_legacy)
        );
        scheduleLegacyListen();
    }

    private boolean tryStartPorcupine() {
        if (!hasPorcupineAssets()) {
            return false;
        }
        String resolvedKey = resolveAccessKey();
        if (TextUtils.isEmpty(resolvedKey)) {
            return false;
        }

        destroyPorcupine();
        try {
            porcupineManager = new PorcupineManager.Builder()
                .setAccessKey(resolvedKey)
                .setKeywordPath(KEYWORD_ASSET)
                .setModelPath(MODEL_ASSET)
                .setSensitivity(PORCUPINE_SENSITIVITY)
                .build(getApplicationContext(), porcupineCallback);
            porcupineManager.start();
            return true;
        } catch (PorcupineException ignored) {
            destroyPorcupine();
            return false;
        }
    }

    private String resolveAccessKey() {
        if (!TextUtils.isEmpty(accessKey)) {
            return accessKey.trim();
        }
        String buildKey = BuildConfig.PICOVOICE_ACCESS_KEY;
        if (!TextUtils.isEmpty(buildKey)) {
            return buildKey.trim();
        }
        return "";
    }

    private boolean hasPorcupineAssets() {
        try {
            String[] files = getAssets().list(WAKEWORD_DIR);
            if (files == null) {
                return false;
            }
            boolean hasKeyword = false;
            boolean hasModel = false;
            for (String file : files) {
                if ("merlin_fr.ppn".equals(file)) {
                    hasKeyword = true;
                }
                if ("porcupine_params_fr.pv".equals(file)) {
                    hasModel = true;
                }
            }
            return hasKeyword && hasModel;
        } catch (IOException e) {
            return false;
        }
    }

    private final PorcupineManagerCallback porcupineCallback = keywordIndex -> mainHandler.post(() -> {
        if (!shouldListen || capturingCommand) {
            return;
        }
        beginCommandCapture();
    });

    private void beginCommandCapture() {
        if (!shouldListen || capturingCommand) {
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            deliverWake(new WakeMatch("assistant", ""));
            return;
        }

        capturingCommand = true;
        pausePorcupine();
        destroyRecognizer();

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(this);

        Intent recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        recognizerIntent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR");
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1200);

        isListening = true;
        mainHandler.postDelayed(() -> {
            if (speechRecognizer != null && capturingCommand) {
                speechRecognizer.startListening(recognizerIntent);
            }
        }, POST_WAKE_STT_DELAY_MS);
    }

    private void pausePorcupine() {
        if (porcupineManager == null) {
            return;
        }
        try {
            porcupineManager.stop();
        } catch (PorcupineException ignored) {
            // ignore
        }
    }

    private void resumePorcupine() {
        if (porcupineManager == null || !shouldListen) {
            return;
        }
        try {
            porcupineManager.start();
        } catch (PorcupineException ignored) {
            stopSelf();
        }
    }

    private void destroyPorcupine() {
        if (porcupineManager == null) {
            return;
        }
        try {
            porcupineManager.stop();
            porcupineManager.delete();
        } catch (PorcupineException ignored) {
            // ignore
        }
        porcupineManager = null;
    }

    private void scheduleLegacyListen() {
        mainHandler.postDelayed(this::startLegacyListening, RESTART_DELAY_MS);
    }

    private void startLegacyListening() {
        if (!shouldListen || isListening || listenMode != ListenMode.LEGACY_STT) {
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            stopSelf();
            return;
        }

        destroyRecognizer();
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(this);

        Intent recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        recognizerIntent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR");
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);

        isListening = true;
        speechRecognizer.startListening(recognizerIntent);
    }

    private void destroyRecognizer() {
        isListening = false;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception ignored) {
                // ignore
            }
            speechRecognizer = null;
        }
    }

    private void handleTranscript(String text, boolean postWake) {
        WakeMatch match = MerlinWakeWordParser.parse(text, postWake);
        if (match == null) {
            return;
        }
        deliverWake(match);
    }

    private void deliverWake(WakeMatch match) {
        shouldListen = false;
        capturingCommand = false;
        destroyPorcupine();
        destroyRecognizer();
        stopForeground(STOP_FOREGROUND_REMOVE);
        running = false;
        activeMode = null;

        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(
            Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NEW_TASK
        );
        launch.putExtra(EXTRA_WAKE_TYPE, match.type);
        launch.putExtra(EXTRA_WAKE_QUERY, match.query);
        startActivity(launch);
        stopSelf();
    }

    private void finishCommandCapture() {
        capturingCommand = false;
        isListening = false;
        destroyRecognizer();
        if (shouldListen && listenMode == ListenMode.PORCUPINE) {
            resumePorcupine();
        }
    }

    private Notification buildNotification(String title, String text) {
        ensureNotificationChannel();

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private void updateNotification(String title, String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(title, text));
        }
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.merlin_listen_channel),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.merlin_listen_channel_desc));
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onReadyForSpeech(Bundle params) {}

    @Override
    public void onBeginningOfSpeech() {}

    @Override
    public void onRmsChanged(float rmsdB) {}

    @Override
    public void onBufferReceived(byte[] buffer) {}

    @Override
    public void onEndOfSpeech() {
        isListening = false;
    }

    @Override
    public void onError(int error) {
        isListening = false;
        if (!shouldListen) {
            return;
        }
        if (capturingCommand) {
            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                deliverWake(new WakeMatch("assistant", ""));
                return;
            }
            finishCommandCapture();
            return;
        }
        if (listenMode == ListenMode.LEGACY_STT) {
            scheduleLegacyListen();
        }
    }

    @Override
    public void onResults(Bundle results) {
        isListening = false;
        ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        boolean postWake = capturingCommand || listenMode == ListenMode.PORCUPINE;
        if (texts != null) {
            for (String text : texts) {
                handleTranscript(text, postWake);
                if (!shouldListen) {
                    return;
                }
            }
        }
        if (capturingCommand) {
            deliverWake(new WakeMatch("assistant", ""));
            return;
        }
        if (shouldListen && listenMode == ListenMode.LEGACY_STT) {
            scheduleLegacyListen();
        }
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
        if (listenMode != ListenMode.LEGACY_STT || capturingCommand) {
            return;
        }
        ArrayList<String> texts = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (texts != null && !texts.isEmpty()) {
            handleTranscript(texts.get(0), false);
        }
    }

    @Override
    public void onEvent(int eventType, Bundle params) {}
}
