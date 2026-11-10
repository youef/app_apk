package sa.aseel.tv;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public final class MemberTimestampTest {
    @Test public void acceptsUtcAndOffsetsWithSupabaseFractionPrecision() {
        assertEquals(0L, MemberAuth.parseBackendTimestamp("1970-01-01T00:00:00Z").getTime());
        assertEquals(100L, MemberAuth.parseBackendTimestamp("1970-01-01T03:00:00.1+03:00").getTime());
        assertEquals(123L, MemberAuth.parseBackendTimestamp("1970-01-01T00:00:00.123456Z").getTime());
    }

    @Test public void rejectsInvalidOrAmbiguousDeadlines() {
        assertNull(MemberAuth.parseBackendTimestamp("2026-02-30T12:00:00Z"));
        assertNull(MemberAuth.parseBackendTimestamp("2026-01-30T12:00:00"));
        assertNull(MemberAuth.parseBackendTimestamp("2026-01-30T12:00:00Z trailing"));
    }
}
