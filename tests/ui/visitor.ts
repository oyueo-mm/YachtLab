// General regression cases start as returning visitors. Onboarding covers a fresh browser separately.
export function returningVisitorState(origin = "http://127.0.0.1:5173") {
  return { cookies: [], origins: [{ origin, localStorage: [{ name: "yachtlab.visited.v1", value: "1" }] }] };
}
