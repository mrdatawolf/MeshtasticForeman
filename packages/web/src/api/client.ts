export interface ClientError extends Error {
  status: number | undefined;
  fieldErrors: Record<string, string[]> | undefined;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
}

class HttpClientError extends Error implements ClientError {
  readonly status: number | undefined;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(
    message: string,
    status: number | undefined,
    fieldErrors: Record<string, string[]> | undefined = undefined,
  ) {
    super(message);
    this.name = "ClientError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

function isAbortError(error: unknown): error is DOMException {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

function validationDetails(value: unknown): {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
} | null {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const error = value.error;
  if (typeof error !== "object" || error === null) return null;

  const rawFields = "fieldErrors" in error ? error.fieldErrors : undefined;
  const rawForms = "formErrors" in error ? error.formErrors : undefined;
  if (typeof rawFields !== "object" || rawFields === null || Array.isArray(rawFields)) return null;

  const fieldErrors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(rawFields)) {
    if (Array.isArray(messages) && messages.every((message) => typeof message === "string")) {
      fieldErrors[field] = messages;
    }
  }
  const formErrors = Array.isArray(rawForms)
    ? rawForms.filter((message): message is string => typeof message === "string")
    : [];
  return { fieldErrors, formErrors };
}

function errorFromResponse(status: number, body: unknown): ClientError {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return new HttpClientError(body.error, status);
  }

  const validation = validationDetails(body);
  if (validation) {
    const fieldMessages = Object.entries(validation.fieldErrors).flatMap(([field, messages]) =>
      messages.map((message) => `${field}: ${message}`),
    );
    const message = [...validation.formErrors, ...fieldMessages].join("; ");
    return new HttpClientError(
      message || "Request failed validation",
      status,
      validation.fieldErrors,
    );
  }

  return new HttpClientError(`HTTP ${status}`, status);
}

export async function request<T>(path: string, options?: RequestOptions): Promise<T | undefined> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined) query.set(key, String(value));
  }
  const queryString = query.toString();
  const url = queryString ? `${path}${path.includes("?") ? "&" : "?"}${queryString}` : path;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options?.method ?? "GET",
      ...(options?.body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options.body),
          }),
      signal: options?.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new HttpClientError("Network error", undefined);
  }

  if (response.status === 204) return undefined;

  const text = await response.text();
  if (!response.ok) {
    if (text.length === 0) throw errorFromResponse(response.status, undefined);
    try {
      throw errorFromResponse(response.status, JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof HttpClientError) throw error;
      throw errorFromResponse(response.status, undefined);
    }
  }

  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpClientError("Response body was not valid JSON", response.status);
  }
}
