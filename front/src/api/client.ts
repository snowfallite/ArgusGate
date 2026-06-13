const BASE = "/api";

const HTTP_ERRORS: Record<number, string> = {
  400: "Неверный запрос",
  401: "Требуется авторизация",
  403: "Нет доступа",
  404: "Ресурс не найден",
  409: "Конфликт данных",
  422: "Ошибка валидации",
  429: "Слишком много запросов",
  500: "Ошибка сервера",
  502: "Провайдер недоступен",
  503: "Сервис не готов",
};

function getToken(): string | null {
  return localStorage.getItem("token");
}

function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/";
}

async function extractError(res: Response): Promise<string> {
  const fallback = HTTP_ERRORS[res.status] ?? `Ошибка ${res.status}`;
  try {
    const err = await res.json();
    if (typeof err.detail === "string") return err.detail;
    if (Array.isArray(err.detail)) {
      // Pydantic validation errors array
      return err.detail.map((d: { msg?: string }) => d.msg ?? "Ошибка").join("; ");
    }
    if (typeof err.message === "string") return err.message;
  } catch {}
  return fallback;
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: formData });

  if (res.status === 401) { clearAuth(); throw new Error(HTTP_ERRORS[401]); }
  if (!res.ok) {
    const detail = await extractError(res);
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearAuth();
    throw new Error(HTTP_ERRORS[401]);
  }

  if (!res.ok) {
    const detail = await extractError(res);
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, formData: FormData) => upload<T>(path, formData),
};

/** DRY-хелперы путей для тест-эндпоинтов слоёв (предотвращают опечатки singular/plural) */
export const layerTestPath = (layerNum: number): string => `/layers/${layerNum}/test`;
export const layerStreamTestPath = (layerNum: number): string => `/layers/${layerNum}/test/stream`;
/** Полный прогон через весь конвейер (без записи в БД/статистику) */
export const pipelineTestPath = (): string => "/pipeline/test";
