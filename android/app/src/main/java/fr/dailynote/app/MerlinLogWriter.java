package fr.dailynote.app;

import android.content.Context;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class MerlinLogWriter {
    private static final String TAG = "Merlin";
    private static final String LOG_FILE = "merlin-debug.log";
    private static final int MAX_BYTES = 512 * 1024;
    private static final Object LOCK = new Object();

    private MerlinLogWriter() {}

    public static void log(Context context, String level, String tag, String message) {
        String safeTag = tag == null || tag.isEmpty() ? TAG : tag;
        String safeMessage = message == null ? "" : message;
        String line = formatLine(level, safeTag, safeMessage);

        switch (level != null ? level : "info") {
            case "error":
                Log.e(safeTag, safeMessage);
                break;
            case "warn":
                Log.w(safeTag, safeMessage);
                break;
            case "debug":
                Log.d(safeTag, safeMessage);
                break;
            default:
                Log.i(safeTag, safeMessage);
                break;
        }

        if (context != null) {
            appendToFile(context.getApplicationContext(), line);
        }
    }

    public static File getLogFile(Context context) {
        return new File(context.getCacheDir(), LOG_FILE);
    }

    public static String readAll(Context context) throws IOException {
        File file = getLogFile(context);
        if (!file.exists()) {
            return "";
        }
        return new String(java.nio.file.Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    public static void appendRaw(Context context, String content) {
        if (context == null || content == null || content.isEmpty()) {
            return;
        }
        appendToFile(context.getApplicationContext(), content);
    }

    private static String formatLine(String level, String tag, String message) {
        String timestamp = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS", Locale.US).format(new Date());
        String levelLabel = level == null ? "INFO" : level.toUpperCase(Locale.US);
        return timestamp + " [" + levelLabel + "] " + tag + ": " + message + "\n";
    }

    private static void appendToFile(Context context, String line) {
        synchronized (LOCK) {
            File file = getLogFile(context);
            try {
                rotateIfNeeded(file);
                try (FileOutputStream out = new FileOutputStream(file, true)) {
                    out.write(line.getBytes(StandardCharsets.UTF_8));
                }
            } catch (IOException e) {
                Log.w(TAG, "Impossible d'écrire le fichier de logs", e);
            }
        }
    }

    private static void rotateIfNeeded(File file) throws IOException {
        if (!file.exists() || file.length() <= MAX_BYTES) {
            return;
        }
        File backup = new File(file.getParentFile(), LOG_FILE + ".1");
        if (backup.exists() && !backup.delete()) {
            Log.w(TAG, "Impossible de supprimer l'ancien backup de logs");
        }
        if (!file.renameTo(backup)) {
            if (!file.delete()) {
                throw new IOException("Rotation des logs impossible");
            }
        }
    }
}
