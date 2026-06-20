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
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.Locale;

public class MerlinListenService extends Service implements RecognitionListener {
    public static final String EXTRA_WAKE_TYPE = "merlin_wake_type";
    public static final String EXTRA_WAKE_QUERY = "merlin_wake_query";

    private static final String TAG = "MerlinListen";

    private static final String CHANNEL_ID = "merlin_listen";
    private static final int NOTIFICATION_ID = 42001;
    private static final long RESTART_DELAY_MS = 600;

    private static volatile boolean running = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer speechRecognizer;
    private boolean shouldListen = false;
    private boolean isListening = false;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        MerlinLogWriter.log(this, "info", TAG, "Service créé");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        shouldListen = true;
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        scheduleListen();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        shouldListen = false;
        running = false;
        MerlinLogWriter.log(this, "info", TAG, "Service détruit");
        destroyRecognizer();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.merlin_listen_channel),
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription(getString(R.string.merlin_listen_channel_desc));
            manager.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.merlin_listen_title))
            .setContentText(getString(R.string.merlin_listen_text))
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private void scheduleListen() {
        mainHandler.postDelayed(this::startListening, RESTART_DELAY_MS);
    }

    private void startListening() {
        if (!shouldListen || isListening) {
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            MerlinLogWriter.log(this, "error", TAG, "Reconnaissance vocale indisponible — arrêt du service");
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
            } catch (Exception e) {
                MerlinLogWriter.log(this, "warn", TAG, "Erreur destruction recognizer: " + e.getMessage());
            }
            speechRecognizer = null;
        }
    }

    private void handleTranscript(String text) {
        if (text == null || text.trim().isEmpty()) {
            return;
        }

        WakeMatch match = WakeWordParser.parse(text);
        if (match == null) {
            return;
        }

        shouldListen = false;
        destroyRecognizer();
        stopForeground(STOP_FOREGROUND_REMOVE);
        running = false;

        MerlinLogWriter.log(this, "info", TAG, "Wake détecté type=" + match.type);

        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        launch.putExtra(EXTRA_WAKE_TYPE, match.type);
        launch.putExtra(EXTRA_WAKE_QUERY, match.query);
        startActivity(launch);
        stopSelf();
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
        MerlinLogWriter.log(this, "warn", TAG, "SpeechRecognizer error: " + speechErrorLabel(error));
        if (!shouldListen) {
            return;
        }
        scheduleListen();
    }

    private static String speechErrorLabel(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "ERROR_AUDIO";
            case SpeechRecognizer.ERROR_CLIENT:
                return "ERROR_CLIENT";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "ERROR_INSUFFICIENT_PERMISSIONS";
            case SpeechRecognizer.ERROR_NETWORK:
                return "ERROR_NETWORK";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "ERROR_NETWORK_TIMEOUT";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "ERROR_NO_MATCH";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "ERROR_RECOGNIZER_BUSY";
            case SpeechRecognizer.ERROR_SERVER:
                return "ERROR_SERVER";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "ERROR_SPEECH_TIMEOUT";
            default:
                return "ERROR_UNKNOWN(" + error + ")";
        }
    }

    @Override
    public void onResults(Bundle results) {
        isListening = false;
        ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (texts != null) {
            for (String text : texts) {
                handleTranscript(text);
                if (!shouldListen) {
                    return;
                }
            }
        }
        if (shouldListen) {
            scheduleListen();
        }
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
        ArrayList<String> texts = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (texts != null && !texts.isEmpty()) {
            handleTranscript(texts.get(0));
        }
    }

    @Override
    public void onEvent(int eventType, Bundle params) {}

    static final class WakeMatch {
        final String type;
        final String query;

        WakeMatch(String type, String query) {
            this.type = type;
            this.query = query;
        }
    }

    static final class WakeWordParser {
        private WakeWordParser() {}

        static WakeMatch parse(String text) {
            String norm = normalize(text);
            if (!norm.contains("merlin")) {
                return null;
            }
            if (isJournalWake(norm)) {
                return new WakeMatch("journal", extractQuery(text));
            }
            return new WakeMatch("assistant", extractQuery(text));
        }

        private static boolean isJournalWake(String norm) {
            if (norm.contains("merlin journal")) return true;
            if (norm.contains("merlin le journal")) return true;
            if (norm.contains("merlin du journal")) return true;
            int merlinIdx = norm.indexOf("merlin");
            int journalIdx = norm.indexOf("journal");
            return merlinIdx >= 0 && journalIdx > merlinIdx && journalIdx - merlinIdx < 25;
        }

        private static String extractQuery(String text) {
            String result = text.trim();
            String[] prefixes = {
                "(?i)^merlin[,:\\s]+",
                "(?i)^dis merlin[,:\\s]+",
                "(?i)^hey merlin[,:\\s]+"
            };
            for (String prefix : prefixes) {
                result = result.replaceFirst(prefix, "");
            }
            result = result.replaceAll("(?i)merlin journal", "");
            result = result.replaceAll("(?i)merlin le journal", "");
            result = result.replaceAll("(?i)merlin du journal", "");
            result = result.replaceAll("(?i)merlin", "");
            return result.trim();
        }

        private static String normalize(String text) {
            String lower = text.toLowerCase(Locale.FRENCH);
            String stripped = java.text.Normalizer.normalize(lower, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "");
            return stripped
                .replaceAll("[,.!?;:]", " ")
                .replaceAll("\\s+", " ")
                .trim();
        }
    }
}
