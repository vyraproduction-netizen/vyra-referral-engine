import {
  GithubPagesPublisherProvider,
  renderGithubPagesDocument,
} from "./github-pages-publisher.ts";

function request() {
  return {
    content_id: "00000000-0000-4000-8000-000000000901",
    language: "en",
    title: "Test article",
    slug: "test-article",
    body: "# Heading\n\nText with a [link](https://example.com/path).",
    excerpt: "Short description",
    meta_title: "Test article",
    meta_description: "Description",
  };
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

Deno.test(
  "GitHub Pages publisher uploads once and verifies a live marker",
  async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const provider = new GithubPagesPublisherProvider({
      token: "test-token",
      repository: "vyraproduction-netizen/vyra-publisher-test",
      branch: "main",
      siteBaseUrl:
        "https://vyraproduction-netizen.github.io/vyra-publisher-test",
      verifyAttempts: 1,
      verifyDelayMs: 0,
      robotsDirective: "index,follow",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });

        if (
          String(url).startsWith("https://api.github.com/") &&
          init?.method !== "PUT"
        ) {
          return new Response("missing", { status: 404 });
        }

        if (init?.method === "PUT") {
          return Response.json(
            {
              content: {
                path: "docs/articles/test-article.html",
              },
            },
            { status: 201 },
          );
        }

        return new Response(
          "<!-- vyra-content-id: 00000000-0000-4000-8000-000000000901 -->",
          { status: 200 },
        );
      },
    });

    const receipt = await provider.publish(request());

    if (receipt.provider !== "github_pages") {
      throw new Error("Unexpected GitHub Pages provider");
    }

    if (
      receipt.published_url !==
        "https://vyraproduction-netizen.github.io/vyra-publisher-test/articles/test-article.html"
    ) {
      throw new Error("Unexpected GitHub Pages URL");
    }

    if (calls.length !== 3) {
      throw new Error("Expected lookup, upload, and live verification");
    }

    const upload = calls.find((call) => call.init?.method === "PUT");

    if (!upload?.init?.body) {
      throw new Error("Article source was not uploaded");
    }
    const uploaded = JSON.parse(String(upload.init.body)) as {
      content: string;
    };
    const html = new TextDecoder().decode(Uint8Array.from(
      atob(uploaded.content),
      (character) => character.charCodeAt(0),
    ));
    if (!html.includes('<meta name="robots" content="index,follow">')) {
      throw new Error("Explicit indexing opt-in was not published");
    }
  },
);

Deno.test("GitHub Pages articles stay out of search by default", () => {
  const html = renderGithubPagesDocument(request());
  if (!html.includes('<meta name="robots" content="noindex,nofollow">')) {
    throw new Error("Default publication must remain noindex");
  }
});

Deno.test("Cloudflare Pages receipt and site navigation are verified", async () => {
  let publishedHtml = "";
  const provider = new GithubPagesPublisherProvider({
    token: "test-token",
    repository: "vyraproduction-netizen/vyraproduction-site",
    branch: "main",
    siteBaseUrl: "https://vyraproduction.pages.dev",
    hostingProvider: "cloudflare_pages",
    verifyAttempts: 1,
    verifyDelayMs: 0,
    fetchImpl: async (url, init) => {
      if (init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as { content: string };
        publishedHtml = new TextDecoder().decode(Uint8Array.from(
          atob(payload.content), (character) => character.charCodeAt(0)
        ));
        return Response.json({}, { status: 201 });
      }
      if (String(url).startsWith("https://api.github.com/")) {
        return new Response("missing", { status: 404 });
      }
      return new Response(publishedHtml, { status: 200 });
    },
  });
  const receipt = await provider.publish(request());
  if (receipt.provider !== "cloudflare_pages" ||
    receipt.published_url !== "https://vyraproduction.pages.dev/articles/test-article") {
    throw new Error("Cloudflare Pages provider or URL is incorrect");
  }
  for (const path of ["/about", "/disclosure", "/privacy"]) {
    if (!publishedHtml.includes(`https://vyraproduction.pages.dev${path}`)) {
      throw new Error(`Missing Cloudflare site navigation: ${path}`);
    }
  }
  if (!publishedHtml.includes('<meta name="robots" content="noindex,nofollow">')) {
    throw new Error("Cloudflare diagnostic article must remain noindex");
  }
});

Deno.test(
  "GitHub Pages publisher reuses an uploaded source while Pages is catching up",
  async () => {
    const source = encodeBase64(
      renderGithubPagesDocument(request()),
    );
    const calls: Array<{ init?: RequestInit }> = [];

    const provider = new GithubPagesPublisherProvider({
      token: "test-token",
      repository: "vyraproduction-netizen/vyra-publisher-test",
      branch: "main",
      siteBaseUrl:
        "https://vyraproduction-netizen.github.io/vyra-publisher-test",
      verifyAttempts: 1,
      verifyDelayMs: 0,
      robotsDirective: "noindex,nofollow",
      fetchImpl: async (url, init) => {
        calls.push({ init });

        if (String(url).startsWith("https://api.github.com/")) {
          return Response.json({
            sha: "existing",
            encoding: "base64",
            content: source,
          });
        }

        return new Response("not ready", { status: 404 });
      },
    });

    let rejected = false;

    try {
      await provider.publish(request());
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error("A non-live page was accepted");
    }

    if (calls.some((call) => call.init?.method === "PUT")) {
      throw new Error("Existing source was uploaded again");
    }
  },
);

Deno.test(
  "GitHub Pages publisher refuses a path owned by another content item",
  async () => {
    const source = encodeBase64(
      "<!-- vyra-content-id: another-content -->",
    );

    const provider = new GithubPagesPublisherProvider({
      token: "test-token",
      repository: "vyraproduction-netizen/vyra-publisher-test",
      branch: "main",
      siteBaseUrl:
        "https://vyraproduction-netizen.github.io/vyra-publisher-test",
      verifyAttempts: 1,
      verifyDelayMs: 0,
      robotsDirective: "noindex,nofollow",
      fetchImpl: async () =>
        Response.json({
          sha: "existing",
          encoding: "base64",
          content: source,
        }),
    });

    let rejected = false;

    try {
      await provider.publish(request());
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error("A colliding Pages path was accepted");
    }
  },
);

Deno.test(
  "GitHub Pages publisher updates a revised article with its existing SHA",
  async () => {
    const previousSource = encodeBase64(
      "<!-- vyra-content-id: 00000000-0000-4000-8000-000000000901 -->\nold",
    );
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const provider = new GithubPagesPublisherProvider({
      token: "test-token",
      repository: "vyraproduction-netizen/vyra-publisher-test",
      branch: "main",
      siteBaseUrl:
        "https://vyraproduction-netizen.github.io/vyra-publisher-test",
      verifyAttempts: 1,
      verifyDelayMs: 0,
      robotsDirective: "noindex,nofollow",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });

        if (String(url).startsWith("https://api.github.com/")) {
          if (init?.method === "PUT") {
            return Response.json(
              {
                content: {
                  path: "docs/articles/test-article.html",
                },
              },
              { status: 200 },
            );
          }

          return Response.json({
            sha: "existing-sha",
            encoding: "base64",
            content: previousSource,
          });
        }

        return new Response(
          "<!-- vyra-content-id: 00000000-0000-4000-8000-000000000901 -->",
          { status: 200 },
        );
      },
    });

    const revised = {
      ...request(),
      body: "# Updated heading\n\nUpdated article body.",
    };

    await provider.publish(revised);

    const upload = calls.find((call) => call.init?.method === "PUT");

    if (!upload?.init?.body) {
      throw new Error("Revised article was not uploaded");
    }

    const payload = JSON.parse(String(upload.init.body));

    if (payload.sha !== "existing-sha") {
      throw new Error("Revised article did not use the existing SHA");
    }
  },
);
