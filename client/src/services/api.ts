const configuredApiBase = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_REACT_APP_API_BASE_URL;

function isLoopbackApiBase(value: string) {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

const API_BASE = (
  import.meta.env.PROD && configuredApiBase && isLoopbackApiBase(configuredApiBase)
    ? "/api"
    : configuredApiBase || "/api"
).replace(/\/$/, "");

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export async function apiRequest<T>(path: string, method: HttpMethod = "GET", body?: unknown): Promise<T> {
  const token = localStorage.getItem("token");
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("API is unreachable. Start the backend server or check the deployed /api route.");
    }

    throw error;
  }

  if (!response.ok) {
    const responseText = await response.text();

    try {
      const errorBody = JSON.parse(responseText) as { message?: string };
      throw new Error(errorBody.message ?? `Request failed (${response.status})`);
    } catch {
      const compactText = responseText.replace(/\s+/g, " ").trim();
      const fallbackMessage =
        compactText && !compactText.startsWith("<")
          ? compactText.slice(0, 180)
          : `Request failed (${response.status})`;

      throw new Error(fallbackMessage);
    }
  }

  return response.json() as Promise<T>;
}
