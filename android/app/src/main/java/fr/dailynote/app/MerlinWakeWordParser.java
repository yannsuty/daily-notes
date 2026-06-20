package fr.dailynote.app;

import java.util.Locale;

final class MerlinWakeWordParser {
    private MerlinWakeWordParser() {}

    static final class WakeMatch {
        final String type;
        final String query;

        WakeMatch(String type, String query) {
            this.type = type;
            this.query = query;
        }
    }

    static WakeMatch parse(String text, boolean postWake) {
        if (text == null || text.trim().isEmpty()) {
            return null;
        }
        WakeMatch full = parseFullTranscript(text);
        if (full != null) {
            return full;
        }
        if (postWake) {
            return parsePostWake(text);
        }
        return null;
    }

    private static WakeMatch parseFullTranscript(String text) {
        String norm = normalize(text);
        if (!norm.contains("merlin")) {
            return null;
        }
        if (isJournalWake(norm)) {
            return new WakeMatch("journal", extractQuery(text));
        }
        return new WakeMatch("assistant", extractQuery(text));
    }

    private static WakeMatch parsePostWake(String text) {
        String norm = normalize(text);
        if (norm.isEmpty()) {
            return new WakeMatch("assistant", "");
        }
        if (isJournalWake(norm) || norm.contains("journal")) {
            return new WakeMatch("journal", extractJournalQuery(text));
        }
        return new WakeMatch("assistant", text.trim());
    }

    private static boolean isJournalWake(String norm) {
        if (norm.contains("merlin journal")) return true;
        if (norm.contains("merlin le journal")) return true;
        if (norm.contains("merlin du journal")) return true;
        int merlinIdx = norm.indexOf("merlin");
        int journalIdx = norm.indexOf("journal");
        return merlinIdx >= 0 && journalIdx > merlinIdx && journalIdx - merlinIdx < 25;
    }

    private static String extractJournalQuery(String text) {
        String result = text.trim();
        result = result.replaceAll("(?i)^journal[,:\\s]+", "");
        result = result.replaceAll("(?i)journal", "");
        return result.trim();
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
