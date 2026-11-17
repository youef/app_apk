package sa.aseel.tv;

import java.util.Set;

/** Bounded playlist failover; never retries a failed item in the same automatic sweep. */
public final class PlaybackRecovery {
    public interface CandidateFilter {
        boolean canPlay(int index);
    }

    private PlaybackRecovery() {}

    /**
     * Live TV wraps within the selected category; episodes/movies only move forward.
     * A missing or invalid candidate ends the sweep instead of looping forever.
     */
    public static int findNext(int total, int current, Set<Integer> failed,
                               boolean wrap, CandidateFilter filter) {
        if(total < 2 || current < 0 || current >= total) return -1;
        for(int step = 1; step < total; step++) {
            int candidate = current + step;
            if(candidate >= total) {
                if(!wrap) break;
                candidate %= total;
            }
            if(failed != null && failed.contains(candidate)) continue;
            if(filter == null || filter.canPlay(candidate)) return candidate;
        }
        return -1;
    }
}
