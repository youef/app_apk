# YouTube support for Al Ezz / Aseel TV

## Status
YouTube support is a planned integration, **not verified on Android 4.4.4**. Do not put YouTube watch/shorts/embed URLs in MP4/HLS `stream_url` columns: Android VideoView cannot play those as direct media.

## Authorized YouTube playback
- Use Google's official IFrame Player API inside a compatible WebView: https://developers.google.com/youtube/iframe_api_reference
- Accept `https://www.youtube.com/watch?v=VIDEO_ID`, `https://youtu.be/VIDEO_ID`, or `https://www.youtube.com/embed/VIDEO_ID`, normalize and validate 11-character video ID, then use `https://www.youtube.com/embed/VIDEO_ID?playsinline=1&controls=1`.
- Keep native controls intact, honor embedding permissions, show playback errors, avoid downloading/transcoding YouTube content or extracting signature URLs.
- Handle TV remote D-pad focus and back/escape, expose a fallback if playback is unavailable.
- On Android 4.4.4 the legacy WebView may not support the current YouTube IFrame player, so do **not** announce playback compatibility without real-device testing.
- Keep current MP4/HLS player unchanged.

## Sources to review
- NASA official channel: https://www.youtube.com/@NASA ; programming schedule: https://www.nasa.gov/live/
- NASA official live video example (status can change): https://www.youtube.com/watch?v=21X5lGlDOfg
- Blender open movies source: https://video.blender.org/ (license per film required)

These are source references, not proof that specific videos can be embedded on the target TV. Separate metadata references from approved playable entries. Avoid movie-stream scraping and unauthorized sources.
