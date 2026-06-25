package fr.dailynote.app;

import android.content.SharedPreferences;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

public class MerlinAgentJobService extends Service {
    public static final String EXTRA_JOB_ID = "merlin_agent_job_id";
    public static final String EXTRA_POLL_URL = "merlin_agent_poll_url";

    private static final String CHANNEL_PROGRESS = "merlin_agent_job";
    private static final String CHANNEL_REPLY = "merlin_agent_reply";
    private static final int NOTIFICATION_PROGRESS_ID = 42002;
    private static final int NOTIFICATION_REPLY_BASE = 43000;
    private static final long POLL_INTERVAL_MS = 2000;
    private static final int MAX_POLL_FAILURES = 30;
    private static final long MAX_WATCH_MS = 15 * 60 * 1000L;
    /** 404 possible tant que le POST client n'a pas créé le job sur Redis. */
    private static final long POST_GRACE_MS = 120_000L;
    private static final String PREFS_NAME = "merlin_agent_job";
    private static final String PREF_JOB_ID = "job_id";
    private static final String PREF_POLL_URL = "poll_url";

    private static volatile boolean running = false;

    private HandlerThread workerThread;
    private Handler workerHandler;
    private String jobId;
    private String pollUrl;
    private volatile boolean shouldRun = false;
    private int consecutiveFailures = 0;
    private long watchStartedAt = 0;
    private String progressDetail = "";

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        workerThread = new HandlerThread("MerlinAgentJobPoll");
        workerThread.start();
        workerHandler = new Handler(workerThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            jobId = prefs.getString(PREF_JOB_ID, null);
            pollUrl = prefs.getString(PREF_POLL_URL, null);
            if (jobId == null || jobId.isEmpty() || pollUrl == null || pollUrl.isEmpty()) {
                stopSelf();
                return START_NOT_STICKY;
            }
        } else {
            jobId = intent.getStringExtra(EXTRA_JOB_ID);
            pollUrl = intent.getStringExtra(EXTRA_POLL_URL);
            if (jobId == null || jobId.isEmpty() || pollUrl == null || pollUrl.isEmpty()) {
                stopSelf();
                return START_NOT_STICKY;
            }
            persistWatch(jobId, pollUrl);
        }

        if (!pollUrl.startsWith("http://") && !pollUrl.startsWith("https://")) {
            MerlinAgentJobBridge.deliverJobFinished(jobId);
            showReplyNotification("Configuration API invalide. Réinstallez la dernière version.");
            finishService();
            return START_NOT_STICKY;
        }

        shouldRun = true;
        consecutiveFailures = 0;
        watchStartedAt = System.currentTimeMillis();
        progressDetail = getString(R.string.merlin_agent_job_text);
        Notification notification = buildProgressNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_PROGRESS_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            );
        } else {
            startForeground(NOTIFICATION_PROGRESS_ID, notification);
        }

        workerHandler.removeCallbacksAndMessages(null);
        workerHandler.post(pollRunnable);
        return START_STICKY;
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (!shouldRun) {
                return;
            }

            if (System.currentTimeMillis() - watchStartedAt > MAX_WATCH_MS) {
                MerlinAgentJobBridge.deliverJobFinished(jobId);
                showReplyNotification("La réflexion de Merlin a pris trop de temps.");
                finishService();
                return;
            }

            try {
                JobPollResult result = pollJobStatus();
                if (result == null) {
                    consecutiveFailures += 1;
                    if (consecutiveFailures >= MAX_POLL_FAILURES) {
                        MerlinAgentJobBridge.deliverJobFinished(jobId);
                        showReplyNotification("Merlin n'a pas pu joindre le serveur. Rouvrez l'app.");
                        finishService();
                    } else {
                        workerHandler.postDelayed(this, POLL_INTERVAL_MS);
                    }
                    return;
                }

                consecutiveFailures = 0;

                if ("done".equals(result.status)) {
                    MerlinAgentJobBridge.deliverJobFinished(jobId);
                    String text = result.reply != null && !result.reply.isEmpty()
                        ? result.reply
                        : "Merlin a terminé sa réponse.";
                    showReplyNotification(text);
                    finishService();
                    return;
                }

                if ("error".equals(result.status)) {
                    MerlinAgentJobBridge.deliverJobFinished(jobId);
                    showReplyNotification(result.reply != null ? result.reply : "Merlin n'a pas pu répondre.");
                    finishService();
                    return;
                }

                if (result.progressDetail != null && !result.progressDetail.isEmpty()) {
                    progressDetail = result.progressDetail;
                    updateProgressNotification();
                }
            } catch (Exception ignored) {
                consecutiveFailures += 1;
                if (consecutiveFailures >= MAX_POLL_FAILURES) {
                    MerlinAgentJobBridge.deliverJobFinished(jobId);
                    showReplyNotification("Merlin n'a pas pu joindre le serveur. Rouvrez l'app.");
                    finishService();
                    return;
                }
            }

            workerHandler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    private JobPollResult pollJobStatus() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(pollUrl).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json");

        int code = connection.getResponseCode();
        if (code == 404) {
            connection.disconnect();
            if (System.currentTimeMillis() - watchStartedAt < POST_GRACE_MS) {
                return null;
            }
            MerlinAgentJobBridge.deliverJobFinished(jobId);
            showReplyNotification("La réflexion de Merlin a expiré.");
            finishService();
            return null;
        }
        if (code < 200 || code >= 300) {
            connection.disconnect();
            return null;
        }

        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                body.append(line);
            }
        } finally {
            connection.disconnect();
        }

        JSONObject json = new JSONObject(body.toString());
        String status = json.optString("status", "");
        String reply = null;
        String stepDetail = null;

        JSONArray steps = json.optJSONArray("steps");
        if (steps != null && steps.length() > 0) {
            JSONObject last = steps.optJSONObject(steps.length() - 1);
            if (last != null) {
                stepDetail = last.optString("label", null);
                String detail = last.optString("detail", null);
                if (detail != null && !detail.isEmpty()) {
                    stepDetail = stepDetail + " — " + detail;
                }
            }
        }

        if ("done".equals(status)) {
            JSONObject result = json.optJSONObject("result");
            if (result != null) {
                reply = result.optString("reply", null);
                if (reply == null || reply.isEmpty()) {
                    reply = "Merlin a terminé sa réponse.";
                }
            }
        } else if ("error".equals(status)) {
            reply = json.optString("error", "Merlin n'a pas pu répondre.");
        }

        return new JobPollResult(status, reply, stepDetail);
    }

    private Notification buildProgressNotification() {
        ensureProgressChannel();
        return buildProgressNotification(progressDetail);
    }

    private void updateProgressNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_PROGRESS_ID, buildProgressNotification(progressDetail));
    }

    private Notification buildProgressNotification(String detail) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_PROGRESS)
            .setContentTitle(getString(R.string.merlin_agent_job_title))
            .setContentText(detail)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build();
    }

    private void ensureProgressChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_PROGRESS,
                getString(R.string.merlin_agent_job_channel),
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription(getString(R.string.merlin_agent_job_channel_desc));
            manager.createNotificationChannel(channel);
        }
    }

    private void showReplyNotification(String body) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_REPLY,
                getString(R.string.merlin_agent_reply_channel),
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(getString(R.string.merlin_agent_reply_channel_desc));
            manager.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            1,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        int notificationId = NOTIFICATION_REPLY_BASE + Math.abs(jobId.hashCode() % 10000);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_REPLY)
            .setContentTitle(getString(R.string.merlin_agent_reply_title))
            .setContentText(body.length() > 180 ? body.substring(0, 177) + "…" : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build();

        manager.notify(notificationId, notification);
    }

    private void finishService() {
        shouldRun = false;
        workerHandler.removeCallbacksAndMessages(null);
        clearWatchPrefs();
        stopForeground(STOP_FOREGROUND_REMOVE);
        running = false;
        stopSelf();
    }

    private void persistWatch(String watchedJobId, String watchedPollUrl) {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString(PREF_JOB_ID, watchedJobId)
            .putString(PREF_POLL_URL, watchedPollUrl)
            .apply();
    }

    private void clearWatchPrefs() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().clear().apply();
    }

    @Override
    public void onDestroy() {
        shouldRun = false;
        running = false;
        if (workerThread != null) {
            workerThread.quitSafely();
            workerThread = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static final class JobPollResult {
        final String status;
        final String reply;
        final String progressDetail;

        JobPollResult(String status, String reply, String progressDetail) {
            this.status = status;
            this.reply = reply;
            this.progressDetail = progressDetail;
        }
    }
}
