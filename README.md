# Smart TV Plus 4.4.4

Android TV viewer, API 19+, with a separate admin catalog editor.

## Admin
Open `admin/index.html` locally in a modern browser. Import the existing `content/catalog.json`, add movies, shows or channels with **licensed HTTPS direct media URLs**, download the JSON, and commit it to `content/catalog.json` on GitHub. Only repository writers can publish updates. The editor is not an authenticated hosted CMS; it does not directly write to GitHub.

## Viewer
The APK has no editing controls. It reads the public catalog from GitHub when opened or when the user selects refresh. This is suitable only for a **public catalog**; do not put private links, secrets, or credentials in it.

## APK build
GitHub Actions > Build Android 4.4.4 APK > Run workflow, then download the resulting artifact. Build has not been verified on hardware.

## Caveats
Android 4.4.4 codec and HLS support varies by device; VideoView may fail for modern formats. GitHub raw content availability requires internet access. The initial catalog is empty until you add licensed content. There is no automatic launch on TV boot yet. Do not claim crash-free operation before device testing.
