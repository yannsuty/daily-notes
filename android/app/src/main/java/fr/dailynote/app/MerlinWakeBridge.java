package fr.dailynote.app;

public final class MerlinWakeBridge {
    private static String pendingType;
    private static String pendingQuery = "";

    private MerlinWakeBridge() {}

    public static void deliverWake(String type, String query) {
        pendingType = type;
        pendingQuery = query != null ? query : "";
        MerlinBackgroundPlugin plugin = MerlinBackgroundPlugin.getInstance();
        if (plugin != null) {
            plugin.emitWake(pendingType, pendingQuery);
            pendingType = null;
            pendingQuery = "";
        }
    }

    public static void flushPendingWake() {
        if (pendingType != null) {
            deliverWake(pendingType, pendingQuery);
        }
    }
}
