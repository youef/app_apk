/* AL EZZ TV — runtime configuration (publishable values only). */
window.ALEZZ_CONFIG = Object.freeze({
  version: "10.0.0",
  build: 16,

  supabaseUrl: "https://qyzmlwtvzzgooccqxglq.supabase.co",
  publishableKey: "sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES",

  /* one-time activation code for the viewing surface */
  activationCode: "556622",

  /* network timeouts (ms) */
  requestTimeout: 6000,

  /* bundled offline catalogue, used when the network is unavailable */
  snapshotUrl: "data/snapshot.json",

  /* brand */
  brand: "العز TV",
  brandLatin: "AL EZZ TV",
  supportUrl: "https://github.com/youef/app_apk"
});
