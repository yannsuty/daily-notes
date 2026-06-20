package fr.dailynote.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

final class ApkDownloadManager {
    interface ProgressListener {
        void onProgress(long downloadedBytes, long totalBytes);
    }

    private static final String PART_FILE_NAME = "merlin-update.apk.part";
    private static final String FINAL_FILE_NAME = "merlin-update.apk";
    private static final String META_FILE_NAME = "merlin-update.meta.json";
    private static final String USER_AGENT = "Merlin-Android-App";
    private static final int BUFFER_SIZE = 16 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int MAX_RETRIES = 12;

    private final File cacheDir;

    ApkDownloadManager(File cacheDir) {
        this.cacheDir = cacheDir;
    }

    File download(String url, long expectedVersionCode, ProgressListener listener) throws Exception {
        File partFile = new File(cacheDir, PART_FILE_NAME);
        File metaFile = new File(cacheDir, META_FILE_NAME);
        File finalFile = new File(cacheDir, FINAL_FILE_NAME);

        DownloadMeta meta = loadMeta(metaFile);
        long startByte = 0;

        if (meta != null && url.equals(meta.url) && expectedVersionCode == meta.versionCode && partFile.exists()) {
            startByte = partFile.length();
            if (meta.downloadedBytes > startByte) {
                startByte = meta.downloadedBytes;
            }
        } else {
            deleteQuietly(partFile);
            deleteQuietly(metaFile);
            deleteQuietly(finalFile);
            meta = new DownloadMeta(url, expectedVersionCode);
        }

        if (meta.totalBytes > 0 && startByte >= meta.totalBytes) {
            return finalizeDownload(partFile, finalFile, metaFile, meta);
        }

        String finalUrl = resolveRedirectUrl(url);
        int attempt = 0;
        Exception lastError = null;

        while (attempt < MAX_RETRIES) {
            try {
                startByte = partFile.exists() ? partFile.length() : 0;
                meta.downloadedBytes = startByte;
                saveMeta(metaFile, meta);
                downloadChunk(finalUrl, partFile, metaFile, meta, startByte, listener);
                return finalizeDownload(partFile, finalFile, metaFile, meta);
            } catch (IOException error) {
                lastError = error;
                attempt += 1;
                if (attempt >= MAX_RETRIES) {
                    break;
                }
                saveMeta(metaFile, meta);
                Thread.sleep(Math.min(30_000L, 1_000L * attempt));
            }
        }

        if (lastError != null) {
            throw lastError;
        }
        throw new IOException("Téléchargement interrompu");
    }

    DownloadMeta getPendingDownload() {
        File metaFile = new File(cacheDir, META_FILE_NAME);
        File partFile = new File(cacheDir, PART_FILE_NAME);
        DownloadMeta meta = loadMeta(metaFile);
        if (meta == null || !partFile.exists() || partFile.length() == 0) {
            return null;
        }
        meta.downloadedBytes = partFile.length();
        if (meta.totalBytes > 0 && meta.downloadedBytes >= meta.totalBytes) {
            return null;
        }
        return meta;
    }

    void clearPendingDownload() {
        deleteQuietly(new File(cacheDir, PART_FILE_NAME));
        deleteQuietly(new File(cacheDir, META_FILE_NAME));
        deleteQuietly(new File(cacheDir, FINAL_FILE_NAME));
    }

    File getReadyApkFile() {
        File finalFile = new File(cacheDir, FINAL_FILE_NAME);
        return finalFile.exists() && finalFile.length() > 0 ? finalFile : null;
    }

    private void downloadChunk(
            String finalUrl,
            File partFile,
            File metaFile,
            DownloadMeta meta,
            long startByte,
            ProgressListener listener) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = openConnection(finalUrl, startByte);
            int status = connection.getResponseCode();

            if (status == HttpURLConnection.HTTP_OK && startByte > 0) {
                connection.disconnect();
                truncateFile(partFile, 0);
                meta.downloadedBytes = 0;
                saveMeta(metaFile, meta);
                connection = openConnection(finalUrl, 0);
                status = connection.getResponseCode();
                startByte = 0;
            }

            if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_PARTIAL) {
                throw new IOException("HTTP " + status);
            }

            long totalBytes = parseTotalBytes(connection, startByte, meta.totalBytes);
            meta.totalBytes = totalBytes;
            saveMeta(metaFile, meta);

            boolean append = startByte > 0 && status == HttpURLConnection.HTTP_PARTIAL;
            try (InputStream input = connection.getInputStream();
                    FileOutputStream output = new FileOutputStream(partFile, append)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                long downloaded = startByte;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    downloaded += read;
                    meta.downloadedBytes = downloaded;
                    if (listener != null) {
                        listener.onProgress(downloaded, totalBytes);
                    }
                    if (downloaded % (256 * 1024) < BUFFER_SIZE) {
                        saveMeta(metaFile, meta);
                    }
                }
                output.flush();
                meta.downloadedBytes = downloaded;
                saveMeta(metaFile, meta);
                if (listener != null) {
                    listener.onProgress(downloaded, totalBytes);
                }
            }
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private HttpURLConnection openConnection(String urlString, long startByte) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/octet-stream");
        connection.setRequestProperty("User-Agent", USER_AGENT);
        if (startByte > 0) {
            connection.setRequestProperty("Range", "bytes=" + startByte + "-");
        }
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.connect();
        return connection;
    }

    private String resolveRedirectUrl(String urlString) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/octet-stream");
        connection.setRequestProperty("User-Agent", USER_AGENT);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.connect();

        int status = connection.getResponseCode();
        if (status == HttpURLConnection.HTTP_MOVED_PERM
                || status == HttpURLConnection.HTTP_MOVED_TEMP
                || status == HttpURLConnection.HTTP_SEE_OTHER
                || status == 307
                || status == 308) {
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null || location.isEmpty()) {
                throw new IOException("Redirection sans URL");
            }
            return location;
        }

        connection.disconnect();
        return urlString;
    }

    private long parseTotalBytes(HttpURLConnection connection, long startByte, long fallbackTotal)
            throws IOException {
        String contentRange = connection.getHeaderField("Content-Range");
        if (contentRange != null && contentRange.contains("/")) {
            String totalPart = contentRange.substring(contentRange.lastIndexOf('/') + 1).trim();
            if (!"*".equals(totalPart)) {
                try {
                    return Long.parseLong(totalPart);
                } catch (NumberFormatException ignored) {
                    // fall through
                }
            }
        }

        if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
            long contentLength = connection.getContentLengthLong();
            if (contentLength > 0) {
                return contentLength;
            }
        }

        if (connection.getResponseCode() == HttpURLConnection.HTTP_PARTIAL) {
            long contentLength = connection.getContentLengthLong();
            if (contentLength > 0) {
                return startByte + contentLength;
            }
        }

        return fallbackTotal;
    }

    private File finalizeDownload(File partFile, File finalFile, File metaFile, DownloadMeta meta) throws IOException {
        if (!partFile.exists() || partFile.length() == 0) {
            throw new IOException("Fichier APK incomplet");
        }
        if (meta.totalBytes > 0 && partFile.length() < meta.totalBytes) {
            throw new IOException("Téléchargement incomplet");
        }

        deleteQuietly(finalFile);
        if (!partFile.renameTo(finalFile)) {
            copyFile(partFile, finalFile);
            deleteQuietly(partFile);
        }
        deleteQuietly(metaFile);
        return finalFile;
    }

    private void copyFile(File source, File target) throws IOException {
        try (FileInputStream input = new FileInputStream(source);
                FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }
    }

    private void truncateFile(File file, long size) throws IOException {
        try (java.io.RandomAccessFile randomAccessFile = new java.io.RandomAccessFile(file, "rw")) {
            randomAccessFile.setLength(size);
        }
    }

    private DownloadMeta loadMeta(File metaFile) {
        if (!metaFile.exists()) {
            return null;
        }
        try (FileInputStream input = new FileInputStream(metaFile)) {
            byte[] bytes = new byte[(int) metaFile.length()];
            int read = input.read(bytes);
            if (read <= 0) {
                return null;
            }
            JSONObject json = new JSONObject(new String(bytes));
            DownloadMeta meta = new DownloadMeta(json.getString("url"), json.getLong("versionCode"));
            meta.downloadedBytes = json.optLong("downloadedBytes", 0);
            meta.totalBytes = json.optLong("totalBytes", 0);
            return meta;
        } catch (Exception error) {
            return null;
        }
    }

    private void saveMeta(File metaFile, DownloadMeta meta) {
        try {
            JSONObject json = new JSONObject();
            json.put("url", meta.url);
            json.put("versionCode", meta.versionCode);
            json.put("downloadedBytes", meta.downloadedBytes);
            json.put("totalBytes", meta.totalBytes);
            try (FileOutputStream output = new FileOutputStream(metaFile)) {
                output.write(json.toString().getBytes());
            }
        } catch (Exception ignored) {
            // best effort persistence
        }
    }

    private void deleteQuietly(File file) {
        if (file.exists() && !file.delete()) {
            file.deleteOnExit();
        }
    }

    static final class DownloadMeta {
        final String url;
        final long versionCode;
        long downloadedBytes;
        long totalBytes;

        DownloadMeta(String url, long versionCode) {
            this.url = url;
            this.versionCode = versionCode;
        }
    }
}
