import {
  PointerSensor,
  type DragDropManager,
  type Draggable,
  type PointerSensorOptions,
} from "@dnd-kit/dom";
import { getFrameTransform } from "@dnd-kit/dom/utilities";

export type ReportTouchSensorOptions = PointerSensorOptions & {
  delay?: number;
  tolerance?: number;
};

type ActiveTouch = {
  feedbackElement: Element;
  identifier: number;
  source: Draggable;
  startEvent: TouchEvent;
  startX: number;
  startY: number;
  started: boolean;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_DELAY_MS = 250;
const DEFAULT_TOLERANCE_PX = 8;
const TOUCH_STATE_ATTRIBUTE = "data-report-touch-state";

function touchByIdentifier(
  touches: TouchList,
  identifier: number,
): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) return touch;
  }
  return null;
}

function touchCoordinates(
  touch: Pick<Touch, "clientX" | "clientY">,
  source: Draggable,
) {
  const offset = getFrameTransform(source.element);
  return {
    x: touch.clientX * offset.scaleX + offset.x,
    y: touch.clientY * offset.scaleY + offset.y,
  };
}

function vibrateOnPickup(ownerDocument: Document): void {
  const ownerWindow = ownerDocument.defaultView;
  if (
    !ownerWindow ||
    ownerWindow.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof ownerWindow.navigator.vibrate !== "function"
  ) {
    return;
  }

  // iOS Safari 尚未在所有版本提供震动能力，其他支持的设备仍可获得一次轻微的拿起反馈。
  try {
    ownerWindow.navigator.vibrate(10);
  } catch {
    // 设备拒绝震动时保留视觉反馈。
  }
}

/**
 * 为手机端提供整卡长按拖动，同时在长按成立前保留页面原生滚动。
 * 桌面鼠标仍由 PointerSensor 负责，避免改变既有交互。
 */
export class ReportTouchSensor extends PointerSensor {
  static override configure = (options: ReportTouchSensorOptions) => ({
    plugin: ReportTouchSensor,
    options,
  });

  private readonly sources = new Map<Draggable, ReportTouchSensorOptions>();
  private readonly documents = new Map<Document, AbortController>();
  private activeTouch: ActiveTouch | null = null;

  constructor(
    manager: DragDropManager,
    options?: ReportTouchSensorOptions,
  ) {
    super(manager, options);
  }

  override bind(
    source: Draggable,
    options: ReportTouchSensorOptions = this.options ?? {},
  ): () => void {
    this.sources.set(source, options);
    const ownerDocument = source.element?.ownerDocument ?? document;
    this.bindDocument(ownerDocument);

    return () => {
      this.sources.delete(source);
      if (
        this.activeTouch?.source === source &&
        !source.element?.isConnected
      ) {
        this.cancelActiveTouch(undefined, true);
      }
    };
  }

  override destroy(): void {
    this.cancelActiveTouch(undefined, true);
    for (const controller of this.documents.values()) {
      controller.abort();
    }
    this.documents.clear();
    this.sources.clear();
    super.destroy();
  }

  private bindDocument(ownerDocument: Document): void {
    if (this.documents.has(ownerDocument)) return;
    const controller = new AbortController();
    const listenerOptions = {
      capture: true,
      signal: controller.signal,
    } satisfies AddEventListenerOptions;

    ownerDocument.addEventListener("touchstart", this.handleTouchStart, {
      ...listenerOptions,
      passive: true,
    });
    ownerDocument.addEventListener("touchmove", this.handleTouchMove, {
      ...listenerOptions,
      passive: false,
    });
    ownerDocument.addEventListener("touchend", this.handleTouchEnd, {
      ...listenerOptions,
      passive: false,
    });
    ownerDocument.addEventListener("touchcancel", this.handleTouchCancel, {
      ...listenerOptions,
      passive: false,
    });
    ownerDocument.addEventListener("contextmenu", this.handleContextMenu, {
      ...listenerOptions,
      passive: false,
    });
    this.documents.set(ownerDocument, controller);
  }

  private sourceForTarget(target: EventTarget | null): Draggable | null {
    if (!(target instanceof Element)) return null;
    for (const source of this.sources.keys()) {
      const activator = source.handle ?? source.element;
      if (activator === target || activator?.contains(target)) return source;
    }
    return null;
  }

  private handleTouchStart = (event: TouchEvent): void => {
    if (this.activeTouch) {
      if (event.touches.length !== 1) {
        this.cancelActiveTouch(event, true);
      }
      return;
    }
    if (
      event.touches.length !== 1 ||
      !this.manager.dragOperation.status.idle
    ) {
      return;
    }
    const source = this.sourceForTarget(event.target);
    const touch = event.touches.item(0);
    if (!source || !touch || source.disabled || !source.element) return;

    const options = this.sources.get(source) ??
      (this.options as ReportTouchSensorOptions | undefined) ?? {};
    const delay = options.delay ?? DEFAULT_DELAY_MS;
    const activeTouch: ActiveTouch = {
      feedbackElement: source.element,
      identifier: touch.identifier,
      source,
      startEvent: event,
      startX: touch.clientX,
      startY: touch.clientY,
      started: false,
      timer: setTimeout(() => {
        if (
          this.activeTouch !== activeTouch ||
          !this.sources.has(source) ||
          !source.element?.isConnected ||
          source.disabled ||
          !this.manager.dragOperation.status.idle
        ) {
          this.cancelActiveTouch();
          return;
        }
        const controller = this.manager.actions.start({
          coordinates: touchCoordinates(
            { clientX: activeTouch.startX, clientY: activeTouch.startY },
            source,
          ),
          event: activeTouch.startEvent,
          source,
        });
        if (controller.signal.aborted) {
          this.cancelActiveTouch();
          return;
        }
        activeTouch.started = true;
        activeTouch.feedbackElement.setAttribute(
          TOUCH_STATE_ATTRIBUTE,
          "dragging",
        );
        vibrateOnPickup(activeTouch.feedbackElement.ownerDocument);
      }, delay),
    };
    this.activeTouch = activeTouch;
    activeTouch.feedbackElement.setAttribute(
      TOUCH_STATE_ATTRIBUTE,
      "pressing",
    );
  };

  private handleTouchMove = (event: TouchEvent): void => {
    const activeTouch = this.activeTouch;
    if (!activeTouch) return;
    const touch = touchByIdentifier(event.touches, activeTouch.identifier);
    if (!touch) return;

    if (!activeTouch.started) {
      const options = this.sources.get(activeTouch.source) ??
        (this.options as ReportTouchSensorOptions | undefined) ?? {};
      const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_PX;
      if (
        Math.hypot(
          touch.clientX - activeTouch.startX,
          touch.clientY - activeTouch.startY,
        ) > tolerance
      ) {
        // 长按成立前发生明显移动时交还浏览器，保持正常页面滚动。
        this.cancelActiveTouch();
      }
      return;
    }

    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.manager.actions.move({
      event,
      to: touchCoordinates(touch, activeTouch.source),
    });
  };

  private handleTouchEnd = (event: TouchEvent): void => {
    const activeTouch = this.activeTouch;
    if (!activeTouch) return;
    const endedTouch = touchByIdentifier(
      event.changedTouches,
      activeTouch.identifier,
    );
    if (!endedTouch) return;

    if (activeTouch.started) {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      this.manager.actions.stop({ event });
    }
    this.clearActiveTouch();
  };

  private handleTouchCancel = (event: TouchEvent): void => {
    const activeTouch = this.activeTouch;
    if (!activeTouch) return;
    const canceledTouch = touchByIdentifier(
      event.changedTouches,
      activeTouch.identifier,
    );
    if (!canceledTouch) return;
    this.cancelActiveTouch(event, true);
  };

  private handleContextMenu = (event: MouseEvent): void => {
    if (!this.activeTouch) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };

  private cancelActiveTouch(event?: Event, canceled = false): void {
    if (canceled && this.activeTouch?.started) {
      this.manager.actions.stop({ event, canceled: true });
    }
    this.clearActiveTouch();
  }

  private clearActiveTouch(): void {
    if (!this.activeTouch) return;
    clearTimeout(this.activeTouch.timer);
    this.activeTouch.feedbackElement.removeAttribute(TOUCH_STATE_ATTRIBUTE);
    this.activeTouch = null;
  }
}
