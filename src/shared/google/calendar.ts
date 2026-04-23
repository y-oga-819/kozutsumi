/**
 * Google Calendar API v3 `events.list` の薄いラッパー。
 *
 * 加工は呼び出し側に任せる。401 検出時は GoogleApiUnauthorizedError を投げるので、
 * 呼び出し側は refreshAccessToken → 1 回 retry する (ADR 0009)。
 */

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export type GoogleCalendarEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  attachments?: Array<unknown>;
};

export type GoogleCalendarEventsListResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type ListEventsParams = {
  accessToken: string;
  calendarId: string;
  /** syncToken と併用不可 (併用時は syncToken が優先され、timeMin/Max は送信しない) */
  timeMin?: string;
  timeMax?: string;
  syncToken?: string;
  pageToken?: string;
  singleEvents?: boolean;
  orderBy?: "startTime" | "updated";
  maxResults?: number;
};

export class GoogleApiUnauthorizedError extends Error {
  readonly name = "GoogleApiUnauthorizedError";
  constructor(message = "Google API returned 401") {
    super(message);
  }
}

export class GoogleApiError extends Error {
  readonly name = "GoogleApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export async function listEvents(
  params: ListEventsParams,
): Promise<GoogleCalendarEventsListResponse> {
  const url = buildListEventsUrl(params);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
    },
  });

  if (response.status === 401) {
    throw new GoogleApiUnauthorizedError();
  }

  if (!response.ok) {
    const body = await safeJson(response);
    throw new GoogleApiError(
      `Google API error: ${response.status} ${response.statusText}`,
      response.status,
      body,
    );
  }

  return (await response.json()) as GoogleCalendarEventsListResponse;
}

function buildListEventsUrl(params: ListEventsParams): string {
  const url = new URL(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events`,
  );

  // syncToken 指定時は timeMin/timeMax を付けない (Google API の制約)
  if (params.syncToken) {
    url.searchParams.set("syncToken", params.syncToken);
  } else {
    if (params.timeMin) url.searchParams.set("timeMin", params.timeMin);
    if (params.timeMax) url.searchParams.set("timeMax", params.timeMax);
  }
  if (params.singleEvents !== undefined) {
    url.searchParams.set("singleEvents", String(params.singleEvents));
  }
  if (params.orderBy) url.searchParams.set("orderBy", params.orderBy);
  if (params.pageToken) url.searchParams.set("pageToken", params.pageToken);
  if (params.maxResults !== undefined) {
    url.searchParams.set("maxResults", String(params.maxResults));
  }

  return url.toString();
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
