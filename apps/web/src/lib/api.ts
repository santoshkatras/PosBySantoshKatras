const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4318';

/** Follow the page host so localhost and 127.0.0.1 both reach the API and share the refresh cookie site. */
export function apiUrl(): string {
  if (typeof window === 'undefined') return CONFIGURED_API_URL;
  try {
    const url = new URL(CONFIGURED_API_URL);
    url.hostname = window.location.hostname;
    return url.origin;
  } catch {
    return CONFIGURED_API_URL;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Options = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const response = await fetch(`${apiUrl()}/api${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    message?: string | string[];
    code?: string;
  };
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join('; ')
      : (data.message ?? 'Request failed');
    throw new ApiError(message, response.status, data.code);
  }
  return data as T;
}
