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
    return {};
  }

  mangaListFromPage(res) {
    const doc = new Document(res.body);
    const els = doc.select("div.page-item-detail");
    const list = [];
    for (const el of els) {
      const a = el.selectFirst(".item-thumb > a");
      if (!a) continue;
      const name = a.attr("title");
      const link = a.getHref;
      const imageUrl = el.selectFirst("img")?.getSrc;
      if (!link || !imageUrl) continue;
      list.push({ name, imageUrl, link });
    }
    const hasNextPage = doc.selectFirst("div.nav-links > div.nav-previous") !== null;
    return { list, hasNextPage };
  }

  toStatus(t) {
    if (!t) return 5;
    t = t.toLowerCase();
    if (t.includes("ongoing")) return 0;
    if (t.includes("completed")) return 1;
    if (t.includes("hiatus")) return 2;
    if (t.includes("dropped")) return 3;
    return 5;
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
    const enc = encodeURIComponent(query);
    const client = new Client();

    let url = `${this.source.baseUrl}/?s=${enc}&post_type=wp-manga&page=${page}`;
    let res = await client.get(url);
    let out = this.mangaListFromPage(res);

    if (out.list.length === 0) {
      url = `${this.source.baseUrl}/?s=${enc}&page=${page}`;
      res = await client.get(url);
      out = this.mangaListFromPage(res);
    }

    if (out.list.length === 0 && page === 1) {
      const kebab = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const acro = query.trim().split(/\s+/).map(w => w[0]?.toLowerCase() || "").join("");
      const candidates = Array.from(new Set([kebab, acro])).filter(s => s);
      for (const slug of candidates) {
        try {
          const r = await client.get(`${this.source.baseUrl}/novel/${slug}/`);
          const d = new Document(r.body);
          let title = d.selectFirst("div.post-title h1, h1.entry-title")?.text.trim();
          if (!title) title = d.selectFirst("meta[property='og:title']")?.attr("content") || slug;
          let img = d.selectFirst("div.summary_image img")?.getSrc;
          if (!img) img = d.selectFirst("meta[property='og:image']")?.attr("content") || this.source.iconUrl;
          out.list.push({ name: title, imageUrl: img, link: `${this.source.baseUrl}/novel/${slug}/` });
        } catch (_) {}
      }
      out.hasNextPage = false;
    }

    return out;
  }

  async getDetail(url) {
    const client = new Client();
    const res = await client.get(url);
    const doc = new Document(res.body);

    let imageUrl = doc.selectFirst("div.summary_image > a > img")?.getSrc;
    if (!imageUrl) imageUrl = doc.selectFirst("meta[property='og:image']")?.attr("content") || "";

    const description = doc.select("#editdescription > p").map(e => e.text.trim()).join("\n");
    const author = doc.select("div.author-content > a").map(e => e.text.trim()).join(", ");
    const artist = doc.select("div.artist-content > a").map(e => e.text.trim()).join(", ");
    const statusText = doc.selectFirst("div.post-status .summary-content")?.text.trim() || "";
    const status = this.toStatus(statusText);
    const genre = doc.select("div.genres-content > a").map(e => e.text.trim());
    const tags = doc.select("div.tags-content > a").map(e => e.text.trim());
    if (tags.length) genre.push(...tags);

    const chapters = [];
    const id = doc.selectFirst("#manga-chapters-holder")?.attr("data-id");
    if (id) {
      try {
        const cr = await client.get(`${this.source.baseUrl}/wp-admin/admin-ajax.php?action=manga_get_chapters&view=full&manga=${id}&paged=1`);
        const cd = new Document(cr.body);
        const ces = cd.select("li.wp-manga-chapter");
        for (const ce of ces) {
          const a = ce.selectFirst("a");
          if (!a) continue;
          const name = a.text.trim();
          const chapterUrl = a.getHref;
          const ds = ce.selectFirst("span.chapter-release-date")?.text.trim();
          let dateUpload = null;
          if (ds) {
            try { dateUpload = this.parseDate(ds); } catch (_) { dateUpload = null; }
          }
          chapters.push({ name, url: chapterUrl, dateUpload, scanlator: null });
        }
      } catch (_) {}
    }

    if (chapters.length === 0) {
      const latest = doc.select("div#latest-manga-releases li");
      for (const li of latest) {
        const a = li.selectFirst("a");
        if (!a) continue;
        const name = a.text.trim();
        const chapterUrl = a.getHref;
        const ds = li.selectFirst("span")?.text.trim();
        let dateUpload = null;
        if (ds) {
          try { dateUpload = this.parseDate(ds); } catch (_) { dateUpload = null; }
        }
        chapters.push({ name, url: chapterUrl, dateUpload, scanlator: null });
      }
    }

    chapters.reverse();

    return { imageUrl, description, genre, author, artist, status, chapters };
  }

  async getHtmlContent(name, url) {
    const res = await new Client().get(url);
    return await this.cleanHtmlContent(res.body);
  }

  async cleanHtmlContent(html) {
    const doc = new Document(html);
    const cont = doc.selectFirst(".reading-content") || doc.selectFirst(".entry-content");
    if (!cont) return html;
    let title = "";
    const t = cont.selectFirst("h1, h2, h3, h4");
    if (t) title = t.text.trim();
    let content = cont.innerHtml;
    if (t) {
      const th = t.outerHtml || "";
      content = content.replace(th, "");
    }
    return `<h2>${title}</h2><hr><br>${content}`;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
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
      december: "12",
    };
    const month = months[parts[0].toLowerCase()];
    if (!month) return String(Date.now());
    const iso = `${parts[2]}-${month}-${parts[1].padStart(2, "0")}`;
    const ts = Date.parse(iso);
    return isNaN(ts) ? String(Date.now()) : String(ts);
  }
}

const extension = new DefaultExtension();