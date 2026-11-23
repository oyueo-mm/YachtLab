import { useSyncExternalStore } from "react";
import { isDiceBusy, subscribeDiceBusy } from "./dice-motion";

/** True while a roll animation is in progress anywhere on the page. */
export const useDiceBusy = () => useSyncExternalStore(subscribeDiceBusy, isDiceBusy, () => false);
