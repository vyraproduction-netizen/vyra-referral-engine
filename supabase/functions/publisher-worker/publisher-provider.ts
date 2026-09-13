export type PublishRequest = {
  content_id: string;
  language: string;
  title: string;
  slug: string;
  body: string;
  excerpt: string | null;
  meta_title: string | null;
  meta_description: string | null;
};

export type PublishReceipt = {
  published_url: string;
  provider: string;
};

export interface PublisherProvider {
  publish(
    request: PublishRequest,
  ): Promise<PublishReceipt>;
}

export class MockPublisherProvider
  implements PublisherProvider {
  async publish(
    request: PublishRequest,
  ): Promise<PublishReceipt> {
    const slug = request.slug.trim();

    if (!slug) {
      throw new Error("Publish slug is required");
    }

    return {
      published_url:
        `https://example.local/published/${encodeURIComponent(slug)}`,
      provider: "mock",
    };
  }
}

export function createPublisherProvider(
  name: string | undefined,
): PublisherProvider {
  if (name === "mock") {
    return new MockPublisherProvider();
  }

  if (!name) {
    throw new Error("PUBLISH_PROVIDER is required");
  }

  throw new Error(
    `Unsupported PUBLISH_PROVIDER: ${name}`,
  );
}
