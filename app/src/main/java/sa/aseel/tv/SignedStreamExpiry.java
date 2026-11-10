package sa.aseel.tv;

import android.net.Uri;

/**
 * Recognises signed media URLs whose query contains an explicit expiry.
 * This never generates signatures, changes tokens or requests unauthorised streams.
 * Unknown expiry formats are left to the normal player/network error handling.
 */
public final class SignedStreamExpiry {
    private SignedStreamExpiry() {}

    private static long positive(String value) {
        if (value == null || !value.matches("[0-9]{1,13}")) return -1L;
        try { return Long.parseLong(value); }
        catch (NumberFormatException ignored) { return -1L; }
    }

    public static long expiresAtSeconds(String raw) {
        if (raw == null || !raw.startsWith("https://")) return -1L;
        try {
            Uri uri = Uri.parse(raw);
            if (uri.getHost() == null) return -1L;
            long start = positive(uri.getQueryParameter("s"));
            long duration = positive(uri.getQueryParameter("e"));
            // This CDN signs URLs using start epoch + relative TTL seconds.
            if (start >= 1500000000L && start < 4000000000L &&
                duration > 0L && duration <= 604800L &&
                uri.getQueryParameter("t") != null) return start + duration;
            // Other CDNs use an absolute Unix expiry in e / expires / exp.
            if (duration >= 1500000000L && duration < 4000000000L)
                return duration;
            for (String name : new String[] {"expires", "exp", "expiry"}) {
                long absolute = positive(uri.getQueryParameter(name));
                if (absolute >= 1500000000L && absolute < 4000000000L)
                    return absolute;
            }
        } catch (Exception ignored) {}
        return -1L;
    }

    public static boolean expired(String url) {
        long expiry = expiresAtSeconds(url);
        return expiry > 0 && expiry <= System.currentTimeMillis() / 1000L + 30L;
    }
}
