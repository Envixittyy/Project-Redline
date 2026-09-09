import "server-only";

import { resolveTimeZone } from "@/lib/date/day";

import {
  characterizeBlackboardCalendar,
  type BlackboardCalendarCharacterization,
} from "./characterization";
import { fetchBlackboardCalendar, type BlackboardFetchDependencies } from "./safe-fetch";
import { parseBlackboardICalendar, type BlackboardFeedItem } from "./ical";

export type BlackboardCurrentStateSnapshot = {
  complete: true;
  observedAt: string;
  observations: BlackboardFeedItem[];
  characterization: BlackboardCalendarCharacterization;
};

/**
 * Small current-state boundary. A supported REST implementation can satisfy
 * this contract later without changing School reconciliation.
 */
export interface BlackboardCurrentStateAdapter {
  read(subscriptionUrl: string): Promise<BlackboardCurrentStateSnapshot>;
}

export class BlackboardIcsCurrentStateAdapter implements BlackboardCurrentStateAdapter {
  constructor(
    private readonly allowedHosts: readonly string[],
    private readonly dependencies: BlackboardFetchDependencies = {},
  ) {}

  async read(subscriptionUrl: string): Promise<BlackboardCurrentStateSnapshot> {
    const source = await fetchBlackboardCalendar(subscriptionUrl, {
      ...this.dependencies,
      allowedHosts: this.allowedHosts,
    });
    const [observations, characterization] = await Promise.all([
      parseBlackboardICalendar(source, {
        allowedHosts: this.allowedHosts,
        workspaceTimeZone: resolveTimeZone(),
      }),
      characterizeBlackboardCalendar(source),
    ]);
    return {
      complete: true,
      observedAt: new Date().toISOString(),
      observations,
      characterization,
    };
  }
}
