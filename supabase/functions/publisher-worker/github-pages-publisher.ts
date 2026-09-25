import type {
  PublisherProvider,
  PublishReceipt,
  PublishRequest,
} from "./publisher-provider.ts";

const GITHUB_API = "https://api.github.com";
const markerPrefix = "<!-- vyra-content-id: ";
type RobotsDirective = "noindex,nofollow" | "index,follow";
type HostingProvider = "github_pages" | "cloudflare_pages";

export type GithubPagesPublisherProviderOptions = {
  token?: string;
  repository?: string;
  branch?: string;
  siteBaseUrl?: string;
  verifyAttempts?: number;
  verifyDelayMs?: number;
  robotsDirective?: RobotsDirective;
  hostingProvider?: HostingProvider;
  fetchImpl?: typeof fetch;
};

type ExistingContent = {
  sha: string;
  content: string;
  encoding: string;
};

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function parseRepository(value: string): { owner: string; repo: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
  if (!match) throw new Error("GITHUB_PUBLISH_REPOSITORY must be owner/repository");
  return { owner: match[1], repo: match[2] };
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash) {
    throw new Error("GITHUB_PUBLISH_BASE_URL must be a plain HTTPS URL");
  }
  return url.toString().replace(/\/$/, "");
}

function validSlug(value: string): string {
  const slug = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,160}$/.test(slug)) {
    throw new Error("GitHub Pages publisher received an invalid slug");
  }
  return slug;
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character] as string));
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function inlineMarkdown(value: string): string {
  const escaped = escapeHtml(value);
  return escaped
    .replace(
      /\[([^\]]+)\]\(([^\s)]+)\)/g,
      (_match, label, href) => {
        const url = safeUrl(href.replace(/&amp;/g, "&"));
        return url
          ? `<a href="${escapeHtml(url)}" rel="nofollow noopener noreferrer">${label}</a>`
          : label;
      },
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    }
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) {
      output.push(
        `<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`,
      );
    }
    list = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (item) {
      flushParagraph();
      list.push(item[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return output.join("\n");
}

export function renderGithubPagesDocument(
  request: PublishRequest,
  robotsDirective: RobotsDirective = "noindex,nofollow",
  siteBaseUrl?: string,
): string {
  const title = escapeHtml(request.meta_title?.trim() || request.title);
  const description = escapeHtml(
    request.meta_description?.trim() || request.excerpt?.trim() || request.title,
  );
  const language = /^[A-Za-z]{2,12}(?:-[A-Za-z0-9]{2,12})?$/.test(
    request.language,
  ) ? request.language : "en";
  const siteNavigation = siteBaseUrl
    ? `<nav aria-label="Site navigation"><a href="${escapeHtml(siteBaseUrl)}/">Home</a> · <a href="${escapeHtml(siteBaseUrl)}/about">How we work</a> · <a href="${escapeHtml(siteBaseUrl)}/disclosure">Affiliate disclosure</a> · <a href="${escapeHtml(siteBaseUrl)}/privacy">Privacy</a></nav>`
    : "";

  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="${robotsDirective}">
  <title>${title}</title>
  <meta name="description" content="${description}">
</head>
<body>
  ${siteNavigation}
  <main>
    ${markerPrefix}${escapeHtml(request.content_id)} -->
    <article>
${renderMarkdown(request.body)}
    </article>
  </main>
  ${siteNavigation}
</body>
</html>
`;
}

function responseError(prefix: string, response: Response, details: string): Error {
  return new Error(
    `${prefix}: HTTP ${response.status}${details ? ` ${details.slice(0, 300)}` : ""}`,
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class GithubPagesPublisherProvider implements PublisherProvider {
  #token: string;
  #owner: string;
  #repo: string;
  #branch: string;
  #siteBaseUrl: string;
  #verifyAttempts: number;
  #verifyDelayMs: number;
  #robotsDirective: RobotsDirective;
  #fetch: typeof fetch;
  #hostingProvider: HostingProvider;

  constructor(options: GithubPagesPublisherProviderOptions = {}) {
    this.#token = required(
      options.token ?? Deno.env.get("GITHUB_PUBLISH_TOKEN"),
      "GITHUB_PUBLISH_TOKEN",
    );
    const repository = parseRepository(required(
      options.repository ?? Deno.env.get("GITHUB_PUBLISH_REPOSITORY"),
      "GITHUB_PUBLISH_REPOSITORY",
    ));
    this.#owner = repository.owner;
    this.#repo = repository.repo;
    this.#branch = required(
      options.branch ?? Deno.env.get("GITHUB_PUBLISH_BRANCH") ?? "main",
      "GITHUB_PUBLISH_BRANCH",
    );
    this.#siteBaseUrl = normalizeBaseUrl(required(
      options.siteBaseUrl ?? Deno.env.get("GITHUB_PUBLISH_BASE_URL"),
      "GITHUB_PUBLISH_BASE_URL",
    ));
    this.#hostingProvider = options.hostingProvider ?? "github_pages";
    this.#verifyAttempts = options.verifyAttempts ??
      (this.#hostingProvider === "cloudflare_pages" ? 45 : 30);
    this.#verifyDelayMs = options.verifyDelayMs ?? 2000;
    const robotsDirective = options.robotsDirective ??
      Deno.env.get("GITHUB_PUBLISH_ROBOTS") ?? "noindex,nofollow";
    if (robotsDirective !== "noindex,nofollow" &&
      robotsDirective !== "index,follow") {
      throw new Error("GITHUB_PUBLISH_ROBOTS must be noindex,nofollow or index,follow");
    }
    this.#robotsDirective = robotsDirective;
    if (!Number.isSafeInteger(this.#verifyAttempts) || this.#verifyAttempts < 1) {
      throw new Error("GITHUB_PUBLISH_VERIFY_ATTEMPTS must be positive");
    }
    if (!Number.isSafeInteger(this.#verifyDelayMs) || this.#verifyDelayMs < 0) {
      throw new Error("GITHUB_PUBLISH_VERIFY_DELAY_MS must be non-negative");
    }
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async publish(request: PublishRequest): Promise<PublishReceipt> {
    const slug = validSlug(request.slug);
    const path = `docs/articles/${slug}.html`;
    const marker = `${markerPrefix}${request.content_id} -->`;
    const publishedUrl = `${this.#siteBaseUrl}/articles/${encodeURIComponent(slug)}${
      this.#hostingProvider === "cloudflare_pages" ? "" : ".html"
    }`;
    const apiUrl =
      `${GITHUB_API}/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(this.#repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${this.#token}`,
      "x-github-api-version": "2022-11-28",
    };

    const lookup = await this.#fetch(
      `${apiUrl}?ref=${encodeURIComponent(this.#branch)}`,
      { headers },
    );
    let existing: ExistingContent | null = null;
    if (lookup.status === 200) {
      existing = await lookup.json() as ExistingContent;
    } else if (lookup.status !== 404) {
      throw responseError(
        "GitHub Pages source lookup failed",
        lookup,
        await lookup.text(),
      );
    }

    const document = renderGithubPagesDocument(
      request,
      this.#robotsDirective,
      this.#hostingProvider === "cloudflare_pages" ? this.#siteBaseUrl : undefined,
    );
    const existingBody = existing?.encoding === "base64"
      ? fromBase64(existing.content)
      : "";

    if (existing && !existingBody.includes(marker)) {
      throw new Error(`GitHub Pages path collision: ${path}`);
    }

    if (!existing || existingBody !== document) {
      const upload = await this.#fetch(apiUrl, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          message: `Publish VYRA content: ${slug}`,
          content: base64(document),
          branch: this.#branch,
          ...(existing ? { sha: existing.sha } : {}),
        }),
      });

      if (!upload.ok) {
        throw responseError(
          "GitHub Pages source upload failed",
          upload,
          await upload.text(),
        );
      }
    }

    for (let attempt = 1; attempt <= this.#verifyAttempts; attempt += 1) {
      const response = await this.#fetch(publishedUrl, {
        headers: { "cache-control": "no-cache" },
      });
      if (response.ok && (await response.text()).includes(marker)) {
        return { published_url: publishedUrl, provider: this.#hostingProvider };
      }
      if (attempt < this.#verifyAttempts && this.#verifyDelayMs > 0) {
        await wait(this.#verifyDelayMs);
      }
    }
    throw new Error(`GitHub Pages deployment is not live yet: ${publishedUrl}`);
  }
}
