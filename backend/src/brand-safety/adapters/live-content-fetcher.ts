import { Injectable, Logger } from '@nestjs/common';

export interface LiveContentFetchResult {
  reachable: boolean;
  captionText?: string;
}

// ADR-0024: a narrow interface, kept behind a port rather than calling a
// platform SDK inline from the monitoring cron. Deliberately minimal --
// reachability plus a caption, nothing else -- per the "one cheap fetch per
// post per cycle" decision.
export interface LiveContentFetcher {
  fetchLiveCaption(publishedUrl: string): Promise<LiveContentFetchResult>;
}

export const LIVE_CONTENT_FETCHER = 'LIVE_CONTENT_FETCHER';

const FETCH_TIMEOUT_MS = 10_000;
const OG_DESCRIPTION_RE = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i;

// Best-effort public-page fetch: no authenticated platform API integration
// exists yet (none is specified anywhere in this epic's scope), so this
// reads whatever a public page's og:description meta tag exposes as a
// caption proxy. Any network error, non-2xx response, or missing tag is
// treated conservatively. This is the risk ADR-0024 already names
// explicitly ("LiveContentFetcher's reliability depends on each social
// platform's public-page... accessibility") -- swapping this for a real
// platform API is a change to this class and its DI binding only (NFR-29).
@Injectable()
export class HttpLiveContentFetcher implements LiveContentFetcher {
  private readonly logger = new Logger(HttpLiveContentFetcher.name);

  async fetchLiveCaption(publishedUrl: string): Promise<LiveContentFetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(publishedUrl, { signal: controller.signal });
      if (!response.ok) {
        return { reachable: false };
      }
      const html = await response.text();
      const match = OG_DESCRIPTION_RE.exec(html);
      return { reachable: true, captionText: match ? match[1] : undefined };
    } catch (error) {
      this.logger.warn(`fetchLiveCaption unreachable for ${publishedUrl}: ${(error as Error).message}`);
      return { reachable: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
