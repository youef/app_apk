# Al Ezz TV v12 — Living Room Native TV / Android 4.4.4+
This release is a **test build**, not a claim of complete decoder support.

## Living-room remote UI
- Dark red TV home with movie/series/YouTube shelves and numbered channel preview.
- Dedicated live TV guide with D-pad focus and scroll.
- CH+/CH− or MEDIA_NEXT/PREVIOUS change live channels immediately.
- Numeric 1–3 digit channel entry is accepted from supported TV remotes.
- Menu / Guide opens the TV channels dialog.

## Native player controls
- Fullscreen ExoPlayer 2.18.7 with controls hidden during playback, touch/OK to reveal.
- Playback source quality selection and variant retry with validated, HTTPS sources only.
- DASH (.mpd), HLS (.m3u8), MP4, MKV/WebM, TS and M4V/MOV best-effort support; a compatible container does not imply the device can decode all audio/video codecs.
- Built-in audio language and subtitle track selection *when supplied by the media*, video aspect ratio and VOD playback speed.
- Error details for unsupported codecs, expired URLs, HTML responses, and network errors.
- V1-signed API19 APK, unique application ID per workflow run to avoid signing conflicts. App data does not migrate across unique IDs.
- On Android 4.4.4 modern YouTube embeds may still be unsupported; only independently approved direct video can be played by native ExoPlayer. No YouTube URL extraction or DRM circumvention.

## Limits
The device's chipset, decoder, TLS, stream/server rights, and actual media files control final playback. A successful CI test verifies compilation and APK packaging, not actual playback on the physical TV.
