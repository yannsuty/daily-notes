package fr.dailynote.app;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;

@CapacitorPlugin(name = "MerlinLog")
public class MerlinLogPlugin extends Plugin {
    @PluginMethod
    public void writeLog(PluginCall call) {
        String level = call.getString("level", "info");
        String tag = call.getString("tag", "Merlin");
        String message = call.getString("message", "");
        MerlinLogWriter.log(getContext(), level, tag, message);
        call.resolve();
    }

    @PluginMethod
    public void readLogs(PluginCall call) {
        try {
            String content = MerlinLogWriter.readAll(getContext());
            JSObject result = new JSObject();
            result.put("content", content);
            call.resolve(result);
        } catch (IOException e) {
            call.reject("Impossible de lire les logs", e);
        }
    }

    @PluginMethod
    public void exportLogs(PluginCall call) {
        String jsBuffer = call.getString("jsBuffer", "");
        if (jsBuffer != null && !jsBuffer.isEmpty()) {
            MerlinLogWriter.appendRaw(getContext(), "\n--- JS buffer ---\n" + jsBuffer + "\n");
        }

        File logFile = MerlinLogWriter.getLogFile(getContext());
        if (!logFile.exists() || logFile.length() == 0) {
            call.reject("Aucun log disponible");
            return;
        }

        Uri uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            logFile
        );

        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_STREAM, uri);
        share.putExtra(Intent.EXTRA_SUBJECT, "Logs Merlin");
        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        Intent chooser = Intent.createChooser(share, "Exporter les logs Merlin");
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
        call.resolve();
    }
}
