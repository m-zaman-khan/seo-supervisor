// @ts-check
// YouTube Data API: the key's entry, the videos that rank for the site's topics, and its channel's numbers.
import { setLine, PASTE, request, isDay } from "./http.mjs";

// https://developers.google.com/youtube/v3/determine_quota_cost
export const youtube = {
  name: "YouTube Data API",
  env: "YOUTUBE_API_KEY",
  endpointEnv: "YOUTUBE_ENDPOINT",
  endpoint: "https://www.googleapis.com/youtube/v3",
  optional: true,
  adds: "the YouTube videos that rank for your topics, and your channel's subscribers, videos and views",
  where: "console.cloud.google.com → APIs & Services → Credentials",
  guide: [
    "The YouTube Data API adds the videos that rank on YouTube for the topics you name, and your own channel's subscribers, videos and views. It needs a Google Cloud project and an API key; Google gives each project a daily quota.",
    "1. Open https://console.cloud.google.com and pick or create a project.",
    '2. Open APIs & Services → Library, search for "YouTube Data API v3" and click Enable.',
    "3. Open APIs & Services → Credentials → Create credentials → API key. Under API restrictions, limit the key to YouTube Data API v3.",
    `4. Copy the key, then in your own terminal run: ${setLine("youtube")}`,
    PASTE,
    'Then fetch with --topics "topic one, topic two" and --youtube-channel @yourhandle. YouTube allows 100 searches a day, so fetch searches at most 5 topics a run.',
  ],
};

// ---------- YouTube ----------
// channels.list costs 1 unit of 10,000 a day; search.list has its own bucket of 100 calls a day, so a run makes at
// most YT_TOPICS searches. The key goes in the X-Goog-Api-Key header, as Google suggests, so it stays out of addresses
// and logs. Redirects aren't followed, so the key never reaches another address, and it's never printed.
// https://cloud.google.com/docs/authentication/api-keys-use
export const YT_TOPICS = 5;
const CHANNEL_ID = /^UC[\w-]{22}$/;
export async function fetchYoutube(key, base, { topics, channel }, notes) {
  const get = (path, params) =>
    request("youtube", youtube, `${base}/${path}?${new URLSearchParams({ ...params, key })}`);
  const n = v => (v != null && Number(v) >= 0 ? Number(v) : null),
    out = { channel: null, topics: [] };
  if (channel) {
    const c = (
        await get("channels", {
          part: "snippet,statistics",
          ...(CHANNEL_ID.test(channel) ? { id: channel } : { forHandle: channel }),
        })
      )?.items?.[0],
      st = c?.statistics || {};
    if (c)
      out.channel = {
        id: c.id,
        title: c.snippet?.title ?? null,
        subscribers: st.hiddenSubscriberCount ? null : n(st.subscriberCount),
        videos: n(st.videoCount),
        views: n(st.viewCount),
      };
    else
      notes.push(
        `YouTube has no channel ${channel}. Check the handle (it starts with @) or the channel ID (it starts with UC).`,
      );
  }
  if (topics.length > YT_TOPICS)
    notes.push(
      `YouTube: searched the first ${YT_TOPICS} of ${topics.length} topics. Search allows 100 calls a day; run fetch again another day with the rest.`,
    );
  for (const topic of topics.slice(0, YT_TOPICS)) {
    const items = (await get("search", { part: "snippet", type: "video", maxResults: 10, q: topic }))?.items || [];
    out.topics.push({
      topic,
      videos: items
        .filter(i => typeof i?.id?.videoId === "string")
        .map(({ id: { videoId }, snippet }) =>
          (s => ({
            id: videoId,
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
            title: s.title ?? "",
            channel: s.channelTitle ?? "",
            published: isDay(String(s.publishedAt).slice(0, 10)) ? s.publishedAt.slice(0, 10) : null,
            own: !!out.channel && s.channelId === out.channel.id,
          }))(snippet && typeof snippet === "object" ? snippet : {}),
        ),
    });
  }
  return out;
}
