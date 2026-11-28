// General regression cases start as returning visitors. Onboarding covers a fresh browser separately.
export function returningVisitorState(origin = "http://127.0.0.1:5173") {
  return { cookies: [], origins: [{ origin, localStorage: [
    { name: "yachtlab.visited.v1", value: "1" },
    // The shop / draw / inventory tours were already seen (tests/ui/onboarding-shop.spec.ts covers a first visit).
    { name: "yachtlab.coach.v1", value: JSON.stringify({ shop: 1, draw: 1, inventory: 1 }) },
  ] }] };
}
