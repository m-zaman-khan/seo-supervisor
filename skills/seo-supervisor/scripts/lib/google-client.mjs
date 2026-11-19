// The project's shared Google OAuth client ("Desktop app" type) for `node google.mjs connect`. Google treats a desktop
// client's secret as non-confidential, since it ships inside every installed app, so it lives in the code. Registered
// in Google Cloud project seo-supervisor-515208; SEO_GOOGLE_SHARED_CLIENT_ID and _SECRET override it.
// https://developers.google.com/identity/protocols/oauth2/native-app
export const SHARED_CLIENT = {
  id: "1026738630972-lmevuu45dvqomm8acfumcm592tjvofkb.apps.googleusercontent.com",
  secret: "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",
};
