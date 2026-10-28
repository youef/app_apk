# Smart TV Plus — Android 4.4.4
Native Android TV viewer (API 19+). No content editing is available to viewers.
## Admin
Only GitHub repository collaborators with write access can edit `content/catalog.json` via GitHub's web editor. Example:
```json
{"items":[{"title":"Demo licensed video","type":"فيلم","url":"https://example.com/licensed-video.mp4"}]}
```
Types can be فيلم, مسلسل, قناة. Use only authorized streaming URLs. Changes appear when viewers tap تحديث المكتبة.
## Build
GitHub Actions → Build Android 4.4.4 APK → Run workflow → Artifacts. APK is a debug build, not yet hardware-tested.
## Compatibility
Android 4.4.4 uses platform VideoView: codec and HLS support depend on device firmware. HTTP is enabled for legacy sources; use HTTPS when possible. Admin authorization is GitHub repository write permissions, not an in-app login.
