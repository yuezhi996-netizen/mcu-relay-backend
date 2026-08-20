import { eventNames, type EventName } from "../types";

export type EventStreamHandlers = {
  readonly onStatus: (status: "connected" | "reconnecting" | "disconnected") => void;
  readonly onEvent: (name: EventName, payload: unknown) => void;
};

export type NamedEventStreamHandlers<TName extends string> = {
  readonly onStatus: (status: "connected" | "reconnecting" | "disconnected") => void;
  readonly onEvent: (name: TName, payload: unknown) => void;
};

export const createNamedEventStream = <TName extends string>(url: string, names: readonly TName[], handlers: NamedEventStreamHandlers<TName>): (() => void) => {
  const source = new EventSource(url);
  source.addEventListener("open", () => handlers.onStatus("connected"));
  source.addEventListener("error", () => {
    handlers.onStatus(source.readyState === EventSource.CONNECTING ? "reconnecting" : "disconnected");
  });
  names.forEach((name) => {
    source.addEventListener(name, (event: Event): void => {
      const message = event as MessageEvent<string>;
      try {
        handlers.onEvent(name, JSON.parse(message.data) as unknown);
      } catch {
        handlers.onEvent(name, { raw: message.data });
      }
    });
  });
  return (): void => source.close();
};

export const createEventStream = (url: string, handlers: EventStreamHandlers): (() => void) => createNamedEventStream(url, eventNames, handlers);
