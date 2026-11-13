# Al Ezz TV — Multi-cloud MP4 video storage

Studio route: /studio/video-upload

Supported storage providers:
- Supabase: for small videos, 50 MiB per file on current Free plan.
- Cloudflare R2: S3-compatible multipart uploads.
- Backblaze B2: S3-compatible multipart uploads.
- Oracle Object Storage: S3 compatibility multipart uploads.

External accounts are not created by this feature. The owner must register,
verify their email, accept any billing requirements, create buckets and keys.
No password or cloud API secret belongs in GitHub.

## Account setup and secrets

If registering new accounts, use the owner-provided email:
a9.y481@gmail.com

Register and complete email verification with each service:
Cloudflare: https://dash.cloudflare.com/
Backblaze: https://secure.backblaze.com/
Oracle: https://cloud.oracle.com/

Create a bucket, a bucket-scoped API key permitting multipart uploads and
object write, and a separately configured PUBLIC READ URL or custom domain.
Make sure the S3 API endpoint and public read URL are not confused.

Cloudflare R2 is configured via these Render environment variables:
- ALEZZ_R2_ACCOUNT_ID
- ALEZZ_R2_REGION (auto)
- ALEZZ_R2_BUCKET
- ALEZZ_R2_ACCESS_KEY_ID
- ALEZZ_R2_SECRET_ACCESS_KEY
- ALEZZ_R2_PUBLIC_BASE_URL (PUBLIC read URL)
- ALEZZ_R2_QUOTA_BYTES (default 10737418240)
- ALEZZ_R2_MAX_FILE_BYTES (default 53687091200)
- ALEZZ_R2_ENDPOINT (optional custom S3 endpoint)

Backblaze B2 uses:
- ALEZZ_B2_REGION (the bucket region, e.g. us-west-004)
- ALEZZ_B2_BUCKET
- ALEZZ_B2_ACCESS_KEY_ID
- ALEZZ_B2_SECRET_ACCESS_KEY
- ALEZZ_B2_PUBLIC_BASE_URL
- ALEZZ_B2_QUOTA_BYTES (default 10737418240)
- ALEZZ_B2_MAX_FILE_BYTES
- ALEZZ_B2_ENDPOINT (optional)

Oracle uses:
- ALEZZ_ORACLE_ENDPOINT (full OCI S3-compatible URL for your namespace)
- ALEZZ_ORACLE_REGION
- ALEZZ_ORACLE_BUCKET
- ALEZZ_ORACLE_ACCESS_KEY_ID
- ALEZZ_ORACLE_SECRET_ACCESS_KEY
- ALEZZ_ORACLE_PUBLIC_BASE_URL
- ALEZZ_ORACLE_QUOTA_BYTES (default 21474836480)
- ALEZZ_ORACLE_MAX_FILE_BYTES

Set credentials ONLY in Render private environment variables. NEVER commit
passwords/credentials or put them in frontend code. Scope keys to video bucket.
Do not grant anonymous or public write permission.

## Browser CORS / multipart

Configure the storage provider's CORS policy to allow
https://app-apk-oquy.onrender.com with PUT, GET, HEAD, the required request
headers, and EXPOSE the ETag response header. A generic S3 policy contains
AllowedOrigins, AllowedMethods, AllowedHeaders and ExposeHeaders fields;
some vendors' dashboards require a different shape. Check the vendor docs.

Studio uploads chunks directly to a signed PUT URL with 600-second expiry.
Completion requires the ETag header for every part. On missing ETag, update
the bucket CORS policy before retrying.

## What works and limitations

- Video is allocated to ONE currently configured center (not copied to all).
- Automatic mode selects among active external providers by projected quota
  utilization (R2, B2, Oracle on ties), with Supabase fallback for small MP4s.
- Studio sends 24 MiB parts and supports retry/resume in the same open tab.
- Supabase stores the resulting URL and provider name for movies/episodes.
- Newly created catalogue entries remain DRAFT until approved.
- Usage/available space is an ESTIMATE based on the files registered in Studio,
  not a real-time provider-billing or account quota readout.
- Current release does NOT replicate videos or fail over between hosts. Set
  up independent backup/retention policy if you need protection from deletion.
- Users must finish external provider registration and configure CORS/public
  URLs before large uploads can work.
- Use GitHub/GitLab for source and optional release archives, not for production
  public MP4 video streaming.
