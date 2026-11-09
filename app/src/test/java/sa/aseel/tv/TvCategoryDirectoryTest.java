package sa.aseel.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class TvCategoryDirectoryTest {
    @Test public void seriesOnlyMatchExplicitRomanceMetadata() throws Exception {
        JSONObject romance = item("1", "مسلسلات رومانسية", "romantic", "رومانسي");
        JSONObject misleading = item("2", "أدب رومان", "drama")
            .put("title_ar", "قصة حب رومانسية");
        ArrayList<JSONObject> rows = new ArrayList<>(Arrays.asList(romance, misleading));
        ArrayList<TvCategoryDirectory.Tile> tiles = TvCategoryDirectory.tiles(rows, "series");
        assertEquals("all", tiles.get(0).key);
        assertEquals(2, tiles.get(0).count);
        assertEquals(1, count(tiles, "genre:romance"));
        assertEquals(Arrays.asList(romance), TvCategoryDirectory.filter(rows, "series", "genre:romance"));
        assertTrue(TvCategoryDirectory.filter(rows, "series", "genre:horror").isEmpty());
    }

    @Test public void moviesGainAndLoseNewCategoriesFromMetadata() throws Exception {
        ArrayList<JSONObject> rows = new ArrayList<>();
        JSONObject movie = item("1", "أفلام وثائقية", "documentary").put("country_code", "SA");
        rows.add(movie);
        assertEquals(1, count(TvCategoryDirectory.tiles(rows, "movie"), "genre:documentary"));
        assertEquals(1, count(TvCategoryDirectory.tiles(rows, "movie"), "region:gulf"));
        rows.add(item("2", "سينما تجريبية", "سينما تجريبية"));
        assertEquals(1, count(TvCategoryDirectory.tiles(rows, "movie"), "label:سينما تجريبية"));
        rows.remove(1);
        assertFalse(TvCategoryDirectory.tiles(rows, "movie").stream()
            .anyMatch(tile -> tile.key.equals("label:سينما تجريبية")));
    }

    @Test public void channelsUseExplicitTypesAndNetworkTagsWithoutDuplicatingTiles() throws Exception {
        JSONObject first = item("1", "قنوات MBC", "sports", "رياضة")
            .put("auto_tags", new JSONArray(Arrays.asList("network:MBC", "news")));
        JSONObject second = item("2", "قنوات موسيقية", "music")
            .put("auto_tags", new JSONArray(Arrays.asList("network:شبكة جديدة")));
        ArrayList<JSONObject> rows = new ArrayList<>(Arrays.asList(first, second));
        ArrayList<TvCategoryDirectory.Tile> tiles = TvCategoryDirectory.tiles(rows, "channel");
        assertEquals("all", tiles.get(0).key);
        assertEquals(1, count(tiles, "network:mbc"));
        assertEquals(1, count(tiles, "type:sports"));
        assertEquals(Arrays.asList(first), TvCategoryDirectory.filter(rows, "channel", "type:news"));
        assertEquals(Arrays.asList(second), TvCategoryDirectory.filter(rows, "channel", "network:شبكة جديدة"));
    }

    @Test public void countsAgreeWithFiltersForLargeLibrary() throws Exception {
        ArrayList<JSONObject> rows = new ArrayList<>();
        for (int i = 0; i < 6000; i++) {
            rows.add(item(String.valueOf(i), "مسلسلات درامية", i % 3 == 0 ? "romance" : "comedy"));
        }
        for (TvCategoryDirectory.Tile tile : TvCategoryDirectory.tiles(rows, "series")) {
            assertEquals(tile.count, TvCategoryDirectory.filter(rows, "series", tile.key).size());
        }
        assertEquals(2000, count(TvCategoryDirectory.tiles(rows, "series"), "genre:romance"));
    }

    private static JSONObject item(String id, String category, String... tags) throws Exception {
        return new JSONObject().put("id", id).put("category_name", category)
            .put("genre_tags", new JSONArray(Arrays.asList(tags)));
    }

    private static int count(ArrayList<TvCategoryDirectory.Tile> tiles, String key) {
        for (TvCategoryDirectory.Tile tile : tiles) {
            if (tile.key.equals(key)) return tile.count;
        }
        throw new AssertionError("Missing tile " + key);
    }
}
