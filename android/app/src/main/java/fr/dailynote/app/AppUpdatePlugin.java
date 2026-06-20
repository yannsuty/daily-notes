package fr.dailynote.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private volatile boolean downloadInProgress = false;

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo info = pm.getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName != null ? info.versionName : "");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                result.put("versionCode", info.getLongVersionCode());
            } else {
                result.put("versionCode", info.versionCode);
            }
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("Impossible de lire la version installée", e);
        }
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            result.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            result.put("allowed", true);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, intent, "installPermissionResult");
            return;
        }
        call.resolve();
    }

    @ActivityCallback
    private void installPermissionResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject payload = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            payload.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            payload.put("allowed", true);
        }
        call.resolve(payload);
    }

    @PluginMethod
    public void getDownloadState(PluginCall call) {
        ApkDownloadManager manager = createDownloadManager();
        ApkDownloadManager.DownloadMeta pending = manager.getPendingDownload();
        File readyApk = manager.getReadyApkFile();

        JSObject result = new JSObject();
        if (readyApk != null) {
            result.put("status", "complete");
            result.put("downloadedBytes", readyApk.length());
            result.put("totalBytes", readyApk.length());
            result.put("percent", 100);
            call.resolve(result);
            return;
        }

        if (pending == null) {
            result.put("status", "idle");
            call.resolve(result);
            return;
        }

        result.put("status", "paused");
        result.put("url", pending.url);
        result.put("versionCode", pending.versionCode);
        result.put("downloadedBytes", pending.downloadedBytes);
        result.put("totalBytes", pending.totalBytes);
        if (pending.totalBytes > 0) {
            result.put("percent", (int) (pending.downloadedBytes * 100 / pending.totalBytes));
        }
        call.resolve(result);
    }

    @PluginMethod
    public void clearDownload(PluginCall call) {
        createDownloadManager().clearPendingDownload();
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("INSTALL_PERMISSION_REQUIRED");
            return;
        }

        if (downloadInProgress) {
            call.reject("DOWNLOAD_IN_PROGRESS");
            return;
        }

        ApkDownloadManager manager = createDownloadManager();
        File readyApk = manager.getReadyApkFile();
        if (readyApk != null) {
            try {
                launchInstaller(readyApk);
                call.resolve();
            } catch (Exception e) {
                call.reject("Installation impossible", e);
            }
            return;
        }

        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL de téléchargement manquante");
            return;
        }

        Long versionCode = call.getLong("versionCode");
        if (versionCode == null) {
            versionCode = 0L;
        }

        downloadInProgress = true;
        long expectedVersionCode = versionCode;

        new Thread(() -> {
            try {
                ApkDownloadManager manager = createDownloadManager();
                File apkFile = manager.download(
                        url,
                        expectedVersionCode,
                        (downloadedBytes, totalBytes) -> emitProgress(downloadedBytes, totalBytes));
                bridge.getActivity().runOnUiThread(() -> {
                    try {
                        launchInstaller(apkFile);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("Installation impossible", e);
                    } finally {
                        downloadInProgress = false;
                    }
                });
            } catch (Exception e) {
                bridge.getActivity().runOnUiThread(() -> {
                    downloadInProgress = false;
                    JSObject payload = new JSObject();
                    payload.put("resumable", true);
                    call.reject("Téléchargement interrompu — réessayez pour reprendre", e, payload);
                });
            }
        }).start();
    }

    private ApkDownloadManager createDownloadManager() {
        File cacheDir = getContext().getExternalCacheDir();
        if (cacheDir == null) {
            cacheDir = getContext().getCacheDir();
        }
        return new ApkDownloadManager(cacheDir);
    }

    private void emitProgress(long downloadedBytes, long totalBytes) {
        JSObject payload = new JSObject();
        payload.put("downloadedBytes", downloadedBytes);
        payload.put("totalBytes", totalBytes);
        if (totalBytes > 0) {
            payload.put("percent", (int) (downloadedBytes * 100 / totalBytes));
        }
        notifyListeners("downloadProgress", payload);
    }

    private void launchInstaller(File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apkFile);

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getContext().startActivity(intent);
    }
}
