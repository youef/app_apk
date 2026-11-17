package sa.aseel.tv;

import org.junit.Test;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import static org.junit.Assert.assertEquals;

public class PlaybackRecoveryTest {
    @Test public void liveWrapsAndNeverReturnsAlreadyFailedChannels() {
        Set<Integer> failed = new HashSet<Integer>(Arrays.asList(0, 2));
        assertEquals(1, PlaybackRecovery.findNext(4, 3, failed, true, null));
        failed.add(1);
        assertEquals(-1, PlaybackRecovery.findNext(4, 3, failed, true, null));
    }

    @Test public void episodesOnlyMoveForwardWithoutWraparound() {
        assertEquals(3, PlaybackRecovery.findNext(5, 2,
            new HashSet<Integer>(Arrays.asList(4)), false, null));
        assertEquals(-1, PlaybackRecovery.findNext(5, 4, null, false, null));
        assertEquals(-1, PlaybackRecovery.findNext(1, 0, null, true, null));
    }

    @Test public void channelCategoryAndSourceAvailabilityAreRespected() {
        assertEquals(4, PlaybackRecovery.findNext(5, 0, null, true,
            new PlaybackRecovery.CandidateFilter() {
                public boolean canPlay(int index) { return index == 4; }
            }));
        assertEquals(-1, PlaybackRecovery.findNext(5, 0, null, true,
            new PlaybackRecovery.CandidateFilter() {
                public boolean canPlay(int index) { return false; }
            }));
    }

    @Test public void invalidIndexDoesNotStartARecoveryLoop() {
        assertEquals(-1, PlaybackRecovery.findNext(5, -1, null, true, null));
        assertEquals(-1, PlaybackRecovery.findNext(5, 5, null, true, null));
    }
}
