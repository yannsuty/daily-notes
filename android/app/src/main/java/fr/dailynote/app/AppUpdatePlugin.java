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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final String APK_FILE_NAME = "merlin-update.apk";

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
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL de téléchargement manquante");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("INSTALL_PERMISSION_REQUIRED");
            return;
        }

        new Thread(() -> {
            try {
                File apkFile = downloadApk(url);
                bridge.getActivity().runOnUiThread(() -> {
                    try {
                        launchInstaller(apkFile);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("Installation impossible", e);
                    }
                });
            } catch (Exception e) {
                bridge.getActivity().runOnUiThread(() -> call.reject("Téléchargement échoué", e));
            }
        }).start();
    }

    private File downloadApk(String urlString) throws Exception {
        File cacheDir = getContext().getExternalCacheDir();
        if (cacheDir == null) {
            cacheDir = getContext().getCacheDir();
        }
        File apkFile = new File(cacheDir, APK_FILE_NAME);
        if (apkFile.exists() && !apkFile.delete()) {
            throw new IllegalStateException("Impossible de supprimer l'ancienne mise à jour");
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/octet-stream");
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(120_000);
        connection.connect();

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("HTTP " + status);
        }

        try (InputStream input = connection.getInputStream();
                FileOutputStream output = new FileOutputStream(apkFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }

        return apkFile;
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
