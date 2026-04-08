const API_BASE =
  import.meta.env.VITE_REACT_APP_API_BASE_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:4000/api";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export async function apiRequest<T>(path: string, method: HttpMethod = "GET", body?: unknown): Promise<T> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(errorBody.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}
