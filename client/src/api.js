export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, data.code || 'ERROR', data.message || 'Request failed.');
  }
  return data;
}
