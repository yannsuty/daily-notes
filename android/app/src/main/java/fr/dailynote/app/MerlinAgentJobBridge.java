package fr.dailynote.app;

/**
 * Relais Service Android → WebView quand un job agent se termine ou que l'app revient au premier plan.
 */
public final class MerlinAgentJobBridge {
    private static String pendingFinishedJobId;
    private static boolean pendingAppForeground;

    private MerlinAgentJobBridge() {}

    public static void deliverJobFinished(String jobId) {
        if (jobId == null || jobId.isEmpty()) {
            return;
        }
        MerlinBackgroundPlugin plugin = MerlinBackgroundPlugin.getInstance();
        if (plugin != null) {
            plugin.emitAgentJobFinished(jobId);
            pendingFinishedJobId = null;
        } else {
            pendingFinishedJobId = jobId;
        }
    }

    public static void deliverAppForeground() {
        MerlinBackgroundPlugin plugin = MerlinBackgroundPlugin.getInstance();
        if (plugin != null) {
            plugin.emitAppForeground();
            pendingAppForeground = false;
        } else {
            pendingAppForeground = true;
        }
    }

    public static void flushPending() {
        if (pendingFinishedJobId != null) {
            deliverJobFinished(pendingFinishedJobId);
        }
        if (pendingAppForeground) {
            deliverAppForeground();
        }
    }
}
