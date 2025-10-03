/*
 * Mangayomi extension for MeioNovel (https://meionovels.com)
 *
 * This source extracts metadata and chapters from the Indonesian light‑novel site
 * MeioNovel.  The implementation is modelled after existing Madara/Mangayomi
 * sources (e.g. wordrain69.js) and attempts to follow the HTML structure used
 * across most Madara powered sites.  The majority of pages can be parsed via
 * CSS selectors against the static markup.  Chapters, however, are loaded
 * asynchronously via a WordPress Ajax endpoint.  To retrieve the full list of
 * chapters this extension calls the site’s admin‑ajax.php handler with the
 * action `manga_get_chapters` and the post ID parsed from the novel page.  If
 * this endpoint is unavailable the extension will fall back to whatever
 * chapters are present in the “Latest Manga Releases” widget on the novel
 * detail page.  Parsing relative dates (e.g. “3 hours ago”) returns the
 * current timestamp.
 */

const mangayomiSources = [
  {
    name: "MeioNovel",
    lang: "id",
    baseUrl: "https://meionovels.com",
    apiUrl: "",
    // Placeholder icon.  If an official icon becomes available in the future
    // replace this URL accordingly.
    iconUrl:
      "https://raw.githubusercontent.com/Schnitzel5/sugoi-modules/main/javascript/icon/id.meionovels.png",
    typeSource: "single",
    itemType: 2,
    version: "0.0.1",
    dateFormat: "",
    dateFormatLocale: "",
    pkgPath: "novel/src/id/meionovels.js",
    isNsfw: false,
    // MeioNovel uses Cloudflare, but the static pages are accessible without
    // additional headers.  Set hasCloudflare to false to avoid extra challenge
    // handling in the app layer.
    hasCloudflare: false,
  },
];

class DefaultExtension extends MProvider {
  /**
   * Fetches headers for an HTTP request.  Not implemented since none of the
   * endpoints used in this extension require custom headers.  Mangayomi
   * automatically applies sensible defaults.
   */
  getHeaders(url) {
    throw new Error("getHeaders not implemented");
  }

  /**
   * Parses a list of novels from an archive/search page.  MeioNovel uses the
   * Madara theme, so each entry is contained in a <div class="page-item-detail">
   * element.  The title, link and thumbnail can be extracted from the
   * descendant .item-thumb <a> and <img> tags.
   *
   * @param {Response} res HTTP response from the archive page
   * @returns {{list: Array<{name: string, imageUrl: string, link: string}>, hasNextPage: boolean}}
   */
  mangaListFromPage(res) {
    const doc = new Document(res.body);
    const mangaElements = doc.select("div.page-item-detail");
    const list = [];
    for (const element of mangaElements) {
      const anchor = element.selectFirst(".item-thumb > a");
      if (!anchor) continue;
      const name = anchor.attr("title");
      const link = anchor.getHref;
      const imageUrl = element.selectFirst("img")?.getSrc;
      list.push({ name, imageUrl, link });
    }
    // In the Madara theme the navigation links for subsequent pages reside
    // inside a .nav-links container.  A “nav-previous” div with an anchor
    // indicates that there are older posts (next page).  If it isn’t present
    // assume no more pages exist.
    const hasNextPage =
      doc.selectFirst("div.nav-links > div.nav-previous") !== null;
    return { list: list, hasNextPage };
  }

  /**
   * Converts human readable status strings into Mangayomi’s numeric codes.
   * 0: ongoing, 1: completed, 2: hiatus, 3: dropped, 5: unknown.
   */
  toStatus(status) {
    if (!status) return 5;
    status = status.toLowerCase();
    if (status.includes("ongoing")) return 0;
    else if (status.includes("completed")) return 1;
    else if (status.includes("hiatus")) return 2;
    else if (status.includes("dropped")) return 3;
    else return 5;
  }

  /**
   * Retrieves novels ordered by popularity.  MeioNovel exposes the `m_orderby`
   * query parameter on archive pages similar to other Madara sites.  To
   * retrieve trending/popular items we use `?m_orderby=trending`.
   *
   * @param {number} page Archive page number (1‑based)
   */
  async getPopular(page) {
    const url = `${this.source.baseUrl}/novel/page/${page}/?m_orderby=trending`;
    const res = await new Client().get(url);
    return this.mangaListFromPage(res);
  }

  /**
   * Retrieves the latest updated novels.  Setting `m_orderby=latest` orders
   * by the most recently updated titles.
   */
  async getLatestUpdates(page) {
    const url = `${this.source.baseUrl}/novel/page/${page}/?m_orderby=latest`;
    const res = await new Client().get(url);
    return this.mangaListFromPage(res);
  }

  /**
   * Performs a search against MeioNovel.  The Madara search query uses the
   * `?s=` parameter on the root domain.  Results still follow the same
   * page‑item markup, so they can be parsed identically.
   */
  async search(query, page, filters) {
    // Encode the query to avoid breaking the URL on spaces or special chars.
    const encoded = encodeURIComponent(query);
    const url = `${this.source.baseUrl}/?s=${encoded}&page=${page}`;
    const res = await new Client().get(url);
    return this.mangaListFromPage(res);
  }

  /**
   * Fetches detailed information about a novel.  The method extracts the
   * synopsis, author, artist, status and genres from the summary section of
   * the novel page.  It then requests the chapter list via the Ajax API if
   * possible.  Should the Ajax request fail, it falls back to parsing the
   * limited chapter list rendered in the “Latest Manga Releases” widget.
   *
   * @param {string} url Absolute URL of the novel
   */
  async getDetail(url) {
    const client = new Client();
    const res = await client.get(url);
    const doc = new Document(res.body);

    // Cover image.
    const imageUrl = doc.selectFirst("div.summary_image > a > img")?.getSrc;
    // Description: gather all paragraphs within the summary content.  The
    // description is contained in #editdescription on MeioNovel.
    const description = doc
      .select("#editdescription > p")
      .map((el) => el.text.trim())
      .join("\n");
    // Author(s).
    const author = doc
      .select("div.author-content > a")
      .map((el) => el.text.trim())
      .join(", ");
    // Artist(s) are rarely specified on MeioNovel; attempt to parse them
    // anyway.  If no artist tags exist this returns an empty string.
    const artist = doc
      .select("div.artist-content > a")
      .map((el) => el.text.trim())
      .join(", ");
    // Status text (e.g. OnGoing, Completed).  Some pages may wrap this
    // inside the post-status list; normalise whitespace before passing to
    // toStatus.
    const statusText = doc
      .selectFirst("div.post-status .summary-content")
      ?.text.trim() || "";
    const status = this.toStatus(statusText);
    // Genres: list of genre names from the summary.
    const genre = doc
      .select("div.genres-content > a")
      .map((el) => el.text.trim());
    // Tags: appended to genres if present.
    const tags = doc
      .select("div.tags-content > a")
      .map((el) => el.text.trim());
    if (tags.length > 0) {
      genre.push(...tags);
    }

    // Attempt to retrieve the chapter list from the Ajax endpoint.  The
    // post ID for Ajax calls resides in the #manga-chapters-holder element’s
    // data-id attribute.  If it cannot be found we’ll fall back to a
    // limited list.
    let chapters = [];
    const id = doc.selectFirst("#manga-chapters-holder")?.attr("data-id");
    if (id) {
      try {
        // Call the admin‑ajax handler to get the chapters.  The request must
        // use a GET as POSTs are blocked.  The view parameter controls the
        // returned markup (full returns both volumes and chapters).  The
        // paged parameter is set to 1 to retrieve all chapters.
        const chapRes = await client.get(
          `${this.source.baseUrl}/wp-admin/admin-ajax.php?action=manga_get_chapters&view=full&manga=${id}&paged=1`,
        );
        const chapDoc = new Document(chapRes.body);
        const chapterElements = chapDoc.select("li.wp-manga-chapter");
        for (const el of chapterElements) {
          const chapterAnchor = el.selectFirst("a");
          if (!chapterAnchor) continue;
          const chapterName = chapterAnchor.text.trim();
          const chapterUrl = chapterAnchor.getHref;
          // Dates in the Ajax response are contained in a span with class
          // chapter-release-date.  If the date includes relative text like
          // “hours ago” we simply use the current timestamp.
          const dateStr = el
            .selectFirst("span.chapter-release-date")
            ?.text.trim();
          let dateUpload = null;
          if (dateStr) {
            try {
              dateUpload = this.parseDate(dateStr);
            } catch (_) {
              dateUpload = null;
            }
          }
          chapters.push({
            name: chapterName,
            url: chapterUrl,
            dateUpload: dateUpload,
            scanlator: null,
          });
        }
      } catch (_) {
        // Ignore Ajax failures; fallback to limited list.
      }
    }
    // Fallback: parse the “Latest Manga Releases” widget on the novel page
    // when no chapters were retrieved from the Ajax call.  This widget lists
    // recent chapters and can at least provide some content.  Each entry is
    // a list item with the chapter title as the anchor text and the anchor
    // href pointing at the chapter.
    if (chapters.length === 0) {
      const latestList = doc.select("div#latest-manga-releases li");
      for (const el of latestList) {
        const chapterAnchor = el.selectFirst("a");
        if (!chapterAnchor) continue;
        const chapterName = chapterAnchor.text.trim();
        const chapterUrl = chapterAnchor.getHref;
        const dateStr = el.selectFirst("span")?.text.trim();
        let dateUpload = null;
        if (dateStr) {
          try {
            dateUpload = this.parseDate(dateStr);
          } catch (_) {
            dateUpload = null;
          }
        }
        chapters.push({
          name: chapterName,
          url: chapterUrl,
          dateUpload: dateUpload,
          scanlator: null,
        });
      }
    }
    // Ensure chapters are sorted from oldest to newest.  Madara returns
    // chapters newest first; reversing yields chronological order.
    chapters.reverse();

    return {
      imageUrl,
      description,
      genre,
      author,
      artist,
      status,
      chapters,
    };
  }

  /**
   * Loads the HTML for a specific chapter and returns the raw body.  The
   * cleaning logic is handled in cleanHtmlContent().
   *
   * @param {string} name Chapter name
   * @param {string} url Chapter URL
   */
  async getHtmlContent(name, url) {
    const client = await new Client();
    const res = await client.get(url);
    return await this.cleanHtmlContent(res.body);
  }

  /**
   * Cleans chapter HTML by extracting the title and reading content.  The
   * chapter page contains the text within a .reading-content container.  A
   * heading (<h3>) precedes the paragraphs.  We assemble a simple HTML
   * snippet containing the title and the content separated by a horizontal
   * rule.  If either the title or content cannot be found the original
   * response body is returned to avoid blank chapters.
   *
   * @param {string} html Raw HTML of the chapter page
   * @returns {string} Sanitised HTML ready for display in the reader
   */
  async cleanHtmlContent(html) {
    const doc = new Document(html);
    // Attempt to find the reading container; this div wraps the entire
    // chapter’s content.  Some chapters may omit the .reading-content class
    // (particularly on older posts) so we fall back to .entry-content.
    const readingContainer =
      doc.selectFirst(".reading-content") || doc.selectFirst(".entry-content");
    if (!readingContainer) {
      return html;
    }
    // Title: look for the first h1/h2/h3 inside the container.
    let title = "";
    const titleEl = readingContainer.selectFirst("h1, h2, h3, h4");
    if (titleEl) {
      title = titleEl.text.trim();
    }
    // Inner HTML of the container holds all paragraphs and images.
    let content = readingContainer.innerHtml;
    // Remove the title element from the content to avoid duplication.  Some
    // pages embed the title as <strong> inside the first heading; we simply
    // remove the entire first heading tag if present.
    if (titleEl) {
      const titleHtml = titleEl.outerHtml || "";
      content = content.replace(titleHtml, "");
    }
    return `<h2>${title}</h2><hr><br>${content}`;
  }

  /**
   * No custom filters are provided by this source.  MeioNovel does not
   * support additional search or genre filters via query parameters.
   */
  getFilterList() {
    return [];
  }

  /**
   * Implementing preferences is outside the scope of this extension.  Throwing
   * an error makes it clear to consumers that no preferences exist.
   */
  getSourcePreferences() {
    throw new Error("getSourcePreferences not implemented");
  }

  /**
   * Parses a date string from the site into a timestamp in milliseconds.  The
   * site uses a mixture of relative expressions (e.g. “3 hours ago”) and
   * absolute formats (“September 28, 2025”).  When a relative date is
   * encountered we simply return the current timestamp.  For absolute dates
   * we map month names to numerical values and construct a UTC date.  If
   * parsing fails the current timestamp is returned as a fallback.
   *
   * @param {string} date Human readable date string
   */
  parseDate(date) {
    if (!date) return String(Date.now());
    const lower = date.toLowerCase();
    if (lower.includes("ago")) {
      return String(Date.now());
    }
    // Normalize the date string by removing commas.
    const clean = date.replace(/,/g, "");
    // Example: "September 28 2025" => ["September", "28", "2025"]
    const parts = clean.split(/\s+/);
    if (parts.length < 3) {
      return String(Date.now());
    }
    const monthName = parts[0];
    const day = parts[1];
    const year = parts[2];
    const months = {
      january: "01",
      february: "02",
      march: "03",
      april: "04",
      may: "05",
      june: "06",
      july: "07",
      august: "08",
      september: "09",
      october: "10",
      november: "11",
      december: "12",
    };
    const month = months[monthName.toLowerCase()];
    if (!month) {
      return String(Date.now());
    }
    const iso = `${year}-${month}-${day.padStart(2, "0")}`;
    const ts = Date.parse(iso);
    return isNaN(ts) ? String(Date.now()) : String(ts);
  }
}