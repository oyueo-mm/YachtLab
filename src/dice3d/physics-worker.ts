/// <reference lib="webworker" />
import { prepareThrow, type SimInput } from "./physics";

/**
 * Off-main-thread throw preparation (A1.1). The physics of the next throw (cannon-es, tens of ms on a
 * slow phone) runs here while the dice rest, so the tap never waits for it and no animation frame is
 * blocked. Values are not known here (and not needed): they are applied on the main thread at the roll.
 */
self.onmessage = (event: MessageEvent<{ id: number; input: SimInput }>) => {
  const { id, input } = event.data;
  try {
    (self as unknown as Worker).postMessage({ id, prepared: prepareThrow(input) });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String(error) });
  }
};
