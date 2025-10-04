const mangayomiSources = [
  {
    "name": "MeioNovel",
    "lang": "id",
    "baseUrl": "https://meionovels.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/CyberDDOS/mangayomi-extensions/main/javascript/icon/id.meionovels.png",
    "typeSource": "single",
    "itemType": 2,
    "version": "0.0.2",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "novel/src/id/meionovels.js",
    "isNsfw": false,
    "hasCloudflare": false
  }
];

class DefaultExtension extends MProvider {
  getHeaders(url) {
    throw new Error("getHeaders not implemented");
  }

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
    const hasNextPage = doc.selectFirst("div.nav-links > div.nav-previous") !== null;
    return { list: list, hasNextPage };
  }

  toStatus(status) {
    if (!status) return 5;
    status = status.toLowerCase();
    if (status.includes("ongoing")) return 0;
    else if (status.includes("completed")) return 1;
    else if (status.includes("hiatus")) return 2;
    else if (status.includes("dropped")) return 3;
    else return 5;
  }

  async getPopular(page) {
    const url = `${this.source.baseUrl}/novel/page/${page}/?m_orderby=trending`;
    const res = await new Client().get(url);
    return this.mangaListFromPage(res);
  }

  async getLatestUpdates(page) {
    const url = `${this.source.baseUrl}/novel/page/${page}/?m_orderby=latest`;
    const res = await new Client().get(url);
    return this.mangaListFromPage(res);
  }

  async search(query, page, filters) {
    const encoded = encodeURIComponent(query);
    const client = new Client();
    let url = `${this.source.baseUrl}/?s=${encoded}&post_type=wp-manga&page=${page}`;
    let res = await client.get(url);
    let result = this.mangaListFromPage(res);
    if (result.list.length === 0) {
      url = `${this.source.baseUrl}/?s=${encoded}&page=${page}`;
      res = await client.get(url);
      result = this.mangaListFromPage(res);
    }
    return result;
  }

  async getDetail(url) {
    const client = new Client();
    const res = await client.get(url);
    const doc = new Document(res.body);

    const imageUrl = doc.selectFirst("div.summary_image > a > img")?.getSrc;
    const description = doc
      .select("#editdescription > p")
      .map((el) => el.text.trim())
      .join("\n");
    const author = doc
      .select("div.author-content > a")
      .map((el) => el.text.trim())
      .join(", ");
    const artist = doc
      .select("div.artist-content > a")
      .map((el) => el.text.trim())
      .join(", ");
    const statusText = doc
      .selectFirst("div.post-status .summary-content")
      ?.text.trim() || "";
    const status = this.toStatus(statusText);
    const genre = doc
      .select("div.genres-content > a")
      .map((el) => el.text.trim());
    const tags = doc
      .select("div.tags-content > a")
      .map((el) => el.text.trim());
    if (tags.length > 0) genre.push(...tags);

    let chapters = [];
    const id = doc.selectFirst("#manga-chapters-holder")?.attr("data-id");
    if (id) {
      try {
        const chapRes = await client.get(
          `${this.source.baseUrl}/wp-admin/admin-ajax.php?action=manga_get_chapters&view=full&manga=${id}&paged=1`
        );
        const chapDoc = new Document(chapRes.body);
        const chapterElements = chapDoc.select("li.wp-manga-chapter");
        for (const el of chapterElements) {
          const chapterAnchor = el.selectFirst("a");
          if (!chapterAnchor) continue;
          const chapterName = chapterAnchor.text.trim();
          const chapterUrl = chapterAnchor.getHref;
          const dateStr = el.selectFirst("span.chapter-release-date")?.text.trim();
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
            scanlator: null
          });
        }
      } catch (_) {}
    }

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
          scanlator: null
        });
      }
    }

    chapters.reverse();

    return {
      imageUrl,
      description,
      genre,
      author,
      artist,
      status,
      chapters
    };
  }

  async getHtmlContent(name, url) {
    const client = await new Client();
    const res = await client.get(url);
    return await this.cleanHtmlContent(res.body);
  }

  async cleanHtmlContent(html) {
    const doc = new Document(html);
    const readingContainer =
      doc.selectFirst(".reading-content") || doc.selectFirst(".entry-content");
    if (!readingContainer) return html;
    let title = "";
    const titleEl = readingContainer.selectFirst("h1, h2, h3, h4");
    if (titleEl) title = titleEl.text.trim();
    let content = readingContainer.innerHtml;
    if (titleEl) {
      const titleHtml = titleEl.outerHtml || "";
      content = content.replace(titleHtml, "");
    }
    return `<h2>${title}</h2><hr><br>${content}`;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    throw new Error("getSourcePreferences not implemented");
  }

  parseDate(date) {
    if (!date) return String(Date.now());
    const lower = date.toLowerCase();
    if (lower.includes("ago")) return String(Date.now());
    const clean = date.replace(/,/g, "");
    const parts = clean.split(/\s+/);
    if (parts.length < 3) return String(Date.now());
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
      december: "12"
    };
    const month = months[monthName.toLowerCase()];
    if (!month) return String(Date.now());
    const iso = `${year}-${month}-${day.padStart(2, "0")}`;
    const ts = Date.parse(iso);
    return isNaN(ts) ? String(Date.now()) : String(ts);
  }
}