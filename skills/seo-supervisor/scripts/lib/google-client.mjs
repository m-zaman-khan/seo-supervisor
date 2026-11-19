// The project's shared Google OAuth client ("Desktop app" type) for `node google.mjs connect`. Google treats a desktop
// client's secret as non-confidential, since it ships inside every installed app, so it lives in the code. Empty means
// there's no shared client, and connect explains how to create one instead.
// https://developers.google.com/identity/protocols/oauth2/native-app
export const SHARED_CLIENT = { id: "", secret: "" };
