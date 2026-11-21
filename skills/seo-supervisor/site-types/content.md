# Content sites, blogs and guides (BLOG)

### BLOG-01 · Topic clusters with a pillar · high
Clusters map to the site's services or product areas. The pillar page comes first, and every post links to its pillar, at least one money page (in a sentence, not a CTA box), and about 3 related posts from the same cluster. Pillars link to every post in their cluster.

### BLOG-02 · The shape of a post · medium
A question-led or problem-led title. An answer of 50 words or less right under the H1. Question-form H2s, each opening with a self-contained 40–60 word answer. Tables for comparisons and costs, numbered steps for processes, 3–5 unique FAQs, and cited sources for factual and regulatory claims. Length follows the topic, never a word count: stop when the question is fully answered.

### BLOG-03 · Research before writing · medium
Read the top 2–3 ranking pages and cover the sections they all share, then add what they miss. Take questions from "People also ask" and support tickets. Use the buyer's vocabulary. Record the primary keyword, its sources and the FAQ sources per post. One primary keyword per post, and no two posts share one.

Name each gap by its kind, with the page you saw it on:
- **coverage:** a question none of them answers
- **depth:** they mention it and move on
- **outdated:** old prices, rules or versions
- **no expert view:** no named author, no first-hand testing, no sources

"Make it longer" isn't a gap. The brief records them under "What's new here" (`strategy.md`).

### BLOG-04 · Authors and dates · high
Every post has a named author with an author page (ProfilePage + Person). `datePublished` and `dateModified` are real, static ISO dates, never `new Date()`. "Updated" dates change only on meaningful edits.

### BLOG-05 · No scaled or templated content · blocker
Don't mass-publish AI-generated or templated posts without expert review and unique substance. Check for leftover AI traces (`utm_source=chatgpt.com`, `data-start` attributes), placeholders and encoding damage. Business facts (warranty, years, prices) render from shared data so posts can't contradict each other.

### BLOG-06 · Categories, tags and pagination · medium
Flat post URLs with the category in the breadcrumb, or nested; follow the profile. Category pages have intros. A browse page with fewer than 3 posts is noindex, and tag pages appear only once there's volume. Pagination is crawlable and self-canonical. A post slug can't clash with a category slug.

### BLOG-07 · Publishing cadence and freshness · low
A steady cadence (e.g. 2 posts a month) beats bursts. Review evergreen posts every 6–12 months, and update or merge decaying ones instead of publishing near-duplicates.

### BLOG-08 · Topics that need extra care, and who, how and why · medium
> Checked 21 Nov 2026 against Google's "Creating helpful, reliable, people-first content" (developers.google.com/search/docs/fundamentals/creating-helpful-content) and its Search Quality Rater Guidelines (11 Sep 2025 edition, section 2.3).
- **Topics that need extra care (YMYL):** Google gives "even more weight to content that aligns with strong E-E-A-T" for topics that "could significantly impact the health, financial stability, or safety of people, or the welfare or well-being of society". It calls them "Your Money or Your Life" topics. Its rater guidelines count among them:
  - news about current events that affects society, "such as elections and trust in public institutions"
  - how to vote, and who may vote
  - content about groups of people, since such pages "have been used to justify or incite violence against groups of people"
  - health, money and safety, and with them security and legal topics (CONTENT-07)
- **On these topics:** a named writer or reviewer who really knows the topic, primary sources for facts, and a visible review date (CONTENT-07, BLOG-04).
- **Stay within what the site knows:** Google lists this as a warning sign: "Did you decide to enter some niche topic area without any real expertise, but instead mainly because you thought you'd get search traffic?" Before planning a post outside the site's field, ask the owner who on the team knows the topic. If no one does, don't plan it.
- **Who, how and why:** Google asks content makers three questions.
  - **Who** made it: a byline where readers expect one, and an author page (BLOG-04). Never a made-up person (CONTENT-11).
  - **How** it was made, beyond whether AI helped: "Sharing details about the processes involved can help readers and visitors better understand" the content. For a review, Google suggests saying "the number of products that were tested, what the test results were, and how the tests were conducted". For a guide: its sources and who checked it. For data: where it came from and when. Where AI or automation helped, say so (CONTENT-12).
  - **Why:** to help people. Content made mainly to attract search visits is what Google warns against.
- **Check:** content review of the posts on these topics and of the about and author pages. A missing "how" note is a suggestion for the owner, never invented: only the owner knows how the work was done.

### BLOG-09 · Publishers: editorial standards and Google News · medium
For news and magazine sites.
- **Editorial standards page:** one page that says three things. How facts are checked before publishing. How corrections are made: a dated note on the article that says what changed. And how conflicts of interest are disclosed: ownership, sponsors, affiliate links, gifts. Link it from the footer, the about page and each correction note. These are the owner's policies: draft the page only from what the owner tells you. Google's News policies don't name corrections or fact-checking; they're how a publisher shows its readers it can be trusted.
- **What Google News asks for:** "Clear dates and bylines", "Information about the authors, publication, and publisher", "Information about the company or network behind the content" and "Contact information". "Sponsorship, including, but not limited to, ownership or affiliate interest, payment, or material support," "should be clearly disclosed to readers" (Google News policies, support.google.com/news/publisher-center/answer/6204050, checked 21 Nov 2026).
- **Getting into Google News:** there's nothing to submit. "Publishers are automatically considered for 'Top stories' or the News tab of Search"; they need high-quality content that meets the Google News content policies (Publisher Center Help, "News content across Google", support.google.com/news/publisher-center/answer/9607025). Article schema isn't required either: "there's no markup requirement to be eligible for Google News features like Top stories", though Article markup tells Google more plainly what the page is (Google's Article structured data docs; SCHEMA-03).
- **AMP:** not needed for search. Google dropped the AMP requirement for the Top stories carousel in 2021: "using the AMP format is no longer required" (Search Central blog, 19 Apr 2021). Keeping an existing AMP version is the owner's call.
- **Ad slots:** reserve each ad slot's space in CSS (`min-height`), so ads don't push the text down when they load. Take extra care with slots near the top of the screen, and don't collapse a slot that usually fills (Google Publisher Tag, "Minimize layout shift", developers.google.com/publisher-tag/guides/minimize-layout-shift; PERF-04). Google's page experience questions ("Understanding page experience in Google Search results") ask whether content avoids "an excessive amount of ads that distract from or interfere with the main content".
- **Infinite scroll:** Google's crawlers "don't 'click' buttons", and infinite scroll and "load more" run on JavaScript. Give each chunk its own URL (`?page=2`), link each page to the next with `<a href>`, and keep pages 2 and on canonical to themselves, never to page one. Google no longer uses `rel="next"` and `rel="prev"` (Google, "Pagination best practices", developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading, checked 21 Nov 2026; URL-08, LINK-07).
- **Check:** the about and policy pages, the article template (byline, dates, correction notes), ad slot CSS and pagination code. Missing policies are owner decisions, never findings the agent fills in.
