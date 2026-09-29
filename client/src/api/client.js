const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const TOKEN_KEY = "truckpool_token";
export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
    if (token)
        localStorage.setItem(TOKEN_KEY, token);
    else
        localStorage.removeItem(TOKEN_KEY);
}
async function request(path, options) {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token)
        headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `error ${res.status}`);
    }
    return res.json();
}
export const api = {
    get: (path) => request(path),
    // `data` es opcional para los endpoints sin cuerpo (logout, por ejemplo):
    // mandar un `{}` sólo para cumplir la firma sería ruido.
    post: (path, data) => request(path, {
        method: "POST",
        body: data === undefined ? undefined : JSON.stringify(data),
    }),
    patch: (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (path) => request(path, { method: "DELETE" }),
};
