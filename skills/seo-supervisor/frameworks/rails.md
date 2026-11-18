# Ruby on Rails

How the rules map onto Rails. Check `config/routes.rb`, `app/views/layouts/application.html.erb`, the helpers that set meta tags, the sitemap and robots controllers, and `ApplicationController`.

## Audit like this
- Crawl `bin/rails s -e production` locally (assets precompiled), or staging.

## Patterns that pass

**Meta tags from one helper (META-03):** `content_for :title` / `:description`, or a `meta_tags` helper, set per action and rendered once in the layout. A canonical helper builds the URL from a configured host plus `request.path`, stripping the query string, fragment and stray `www.` (URL-04):
```ruby
def canonical_url(path = request.path)
  "#{ENV.fetch('SITE_URL')}#{path.split('?').first}"
end
```

**Trailing slash (URL-02):** Rails routes match `/page` and `/page/` alike, so both return 200. Redirect the non-preferred form in nginx, the CDN or Rack middleware, and generate links in one style.

**robots.txt and staging (CRAWL-03, CRAWL-04):** serve robots from a controller keyed on `ENV["SEO_ALLOW_INDEXING"]`. Set `X-Robots-Tag` in `ApplicationController`:
```ruby
before_action { response.set_header("X-Robots-Tag", "noindex, nofollow") unless ENV["SEO_ALLOW_INDEXING"] == "true" }
```
Add `noindex, follow` for any request with filter or search parameters (CRAWL-10).

**Sitemaps (MAP-01 to MAP-04):** a `SitemapsController` serving an index plus `/sitemaps/:kind.xml` built with `builder`. `lastmod` comes from `updated_at`; cache it for an hour.

**Status codes (CRAWL-05):** `raise ActionController::RoutingError` or `head :not_found` for unknown records, `head :gone` for removed ones, and `redirect_to …, status: :moved_permanently` for renames. Route-level legacy redirects: `get "/old", to: redirect("/new/", status: 301)`.

**JSON-LD (SCHEMA-01):** render from a hash with `json_escape`:
```erb
<script type="application/ld+json"><%= raw json_escape(schema_hash.to_json) %></script>
```

**Turbo:** make sure full page loads render all SEO content; don't load content only through Turbo frames that crawlers won't request (REND-01).
