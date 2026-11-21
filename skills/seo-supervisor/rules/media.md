# Images and video (MEDIA)

> Checked **17 Nov 2026** against Google's image, Discover and video documentation.

### MEDIA-01 · Content images are real `<img>` elements · high
- **Check:** code: hero and content images set as CSS `background-image`; `<picture>` or `srcset` without a fallback `src`.
- **Pass:** every image that should be found uses `<img src>` (Google doesn't index CSS background images), with a fallback `src` on `srcset`/`<picture>`. Inline SVG uses `<title>`.

### MEDIA-02 · Images are described and named · medium
- **Check:** crawler `img-alt`, and `img-alt-quality` (low, under CONTENT-08): alt text that is a file name (`IMG_4032.jpg`, the image's own file name), a bare word such as "image" or "photo", a list of four or more short comma-separated keywords (Google's image guide warns against keyword-stuffed alt text), or over 150 characters (our own line; a long description belongs in the text or a caption). Empty alt on decorative images is right and isn't flagged. Filenames in the image folder or CMS.
- **Pass:** alt text describes the image in context (CONTENT-08); filenames are descriptive (`ssl-certificate-chain-diagram.webp`, not `IMG_4032.jpg`) and translated per locale; the same image uses the same URL everywhere; formats are BMP, GIF, JPEG, PNG, WebP, SVG or AVIF, with an extension that matches.

### MEDIA-03 · Each page signals its preferred thumbnail · medium
- **Check:** `primaryImageOfPage`, `image` on the page's `mainEntity`, or `og:image`.
- **Pass:** a relevant image, not a logo, text-heavy graphic or extreme aspect ratio. Publishers wanting Google Discover: images at least 1200 px wide (over 300,000 pixels, ideally 16:9) plus `max-image-preview:large`.
- **Crawler:** flags indexable pages whose robots rules don't include `max-image-preview:large` (`no-large-preview`, low), counted once for the site.
- **Size:** the crawler flags og:images narrower than 1200 px (`og-image-small`, low), read from the image header.

### MEDIA-04 · Image sitemaps only where they help · low
- Optional. Useful when images live on a CDN or are loaded in ways crawlers miss. Only `<image:loc>` is used; verify the CDN host in Search Console.
- **Crawler:** `image-sitemap-tags` (low, under MAP-01): an `<image:image>` without `<image:loc>`, or over 1,000 images for one page.

### MEDIA-05 · Videos get indexed on watch pages · medium
- **Check:** pages with video; robots rules for video files and thumbnails.
- **Pass:** a video gets video results only on a page where it's the main content (a watch page). Embeds inside articles, products or categories generally don't. Video files and thumbnails aren't blocked by robots.txt, noindex or login, and use stable URLs (expiring CDN URLs break indexing). Thumbnails are at least 60×30.
- **Video sitemaps:** crawler `video-sitemap-tags` (low, under MAP-01): a `<video:video>` without `<video:thumbnail_loc>`, `<video:title>`, a `<video:description>` of at most 2,048 characters, and either `<video:content_loc>` (preferred) or `<video:player_loc>`.

### MEDIA-06 · VideoObject is complete · high (on watch pages)
- **Required:** `name`, `thumbnailUrl`, `uploadDate` (ISO 8601 with a timezone).
- **Recommended:** `contentUrl` (the most effective), `embedUrl`, `duration`, `description`, `creator`.
- Use `regionsAllowed` or `ineligibleRegion`, not both.
- **Key moments:** `Clip` (name, `startOffset`, a `?t=` URL, unique starts) or `SeekToAction` (a target with `{seek_to_second_number}`). The video must be at least 30 seconds long, and `nosnippet` turns key moments off.
- **Live streams:** `BroadcastEvent`.
- After launch, watch Search Console's Video indexing report.

### MEDIA-07 · Images say who made them, and whether AI did · low
> Checked **21 Nov 2026** against Google's image metadata documentation, IPTC's Photo Metadata Standard 2025.1 (iptc.org) and the C2PA 2.2 specification (spec.c2pa.org).
- **Why:** Google Images reads the IPTC fields in an image file: Creator, Credit Line and Copyright Notice, and the Digital Source Type, where `trainedAlgorithmicMedia`, `compositeWithTrainedAlgorithmicMedia`, `compositeSynthetic` and `algorithmicMedia` mark an image made or changed by an algorithm. It can also show C2PA Content Credentials (version 2.1 or later) in "About this image" (developers.google.com/search/docs/appearance/structured-data/image-license-metadata).
- **How it's stored:** IPTC's Creator is XMP `dc:creator` (IIM 2:80 By-line); Digital Source Type is XMP `Iptc4xmpExt:DigitalSourceType`, a URI from `http://cv.iptc.org/newscodes/digitalsourcetype/`, with no IIM equivalent. C2PA embeds its manifest in JPEG APP11 segments, a PNG `caBX` chunk, or a WebP `C2PA` chunk at the end of the file.
- **Crawler (information only):** for the images PERF-08 weighs, `media.imageCredits` counts those naming a creator, lists those labelled as made with AI and those without a creator, and counts those with Content Credentials. It reads the first 64 KB of each file, where JPEG and PNG keep their metadata; WebP keeps it at the end, so a WebP's label usually isn't seen. Image CDNs and optimisers often strip metadata, so read the served files, not the originals.
- **Pass:** images made or edited with generative AI carry the Digital Source Type, and photos the site owns name their creator.
- **Fix:** `scripts/images.mjs --label-ai public/hero.jpg,public/team.png [--source compositeWithTrainedAlgorithmicMedia]` writes the label into the XMP of the JPEG and PNG files the owner names (default `trainedAlgorithmicMedia`, "Created using Generative AI"), next to any metadata already there, without re-encoding the image. It's a dry run until `--yes` and the owner's yes; it keeps each original as `hero.original.jpg`, reads the label back from the new file, and leaves alone a file that's already labelled or isn't JPEG or PNG. Make sure the image pipeline or CDN keeps metadata, then re-run the audit to confirm the label survives.
