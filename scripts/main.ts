const LOG_NS = "[Controlled shorts]";
const log = console.log.bind(console, LOG_NS);
const warn = console.warn.bind(console, LOG_NS);

function waitForElement(
  selector: string,
  options: { context?: HTMLElement; limit?: number } = {}
): Promise<HTMLElement> {
  const context = options?.context ?? document;
  const limit = options?.limit ?? 5000;

  let intervalId: number;

  const elementPromise = new Promise<HTMLElement>((resolve) => {
    intervalId = setInterval(() => {
      const found = context.querySelector<HTMLElement>(selector);
      if (found) {
        clearInterval(intervalId);
        resolve(found);
      }
    }, 100);
  });

  return Promise.race([
    elementPromise,
    timeout(limit) as Promise<HTMLElement>,
  ]).finally(() => clearInterval(intervalId));
}

function timeout(time: number) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), time)
  );
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

class ProgressBar extends EventTarget {
  static id = "controlled-shorts-progress-bar";
  static styles = `
:host {
  --progress: 0;
}

.container {
  cursor: pointer;
  width: 100%;
  height: 6px;
  position: relative;
}

.track {
  width: 100%;
  height: 100%;
  background: #999;
}

.thumb {
  --size: 12px;

  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  left: calc(var(--progress) * 100%);

  background: #f00;
  width: var(--size);
  height: var(--size);
  border-radius: var(--size);
}

.container:not(:hover) .thumb {
  display: none;
}

.progress {
  position: absolute;
  bottom: 0;
  left: 0px;
  height: 100%;
  width: 100%;

  transform-origin: left;
  transform: scaleX(calc(var(--progress)));

  background: #f00;
}
  `;

  private host: HTMLDivElement;
  private shadowRoot: ShadowRoot;
  private container: HTMLElement;

  constructor() {
    super();
    this.host = document.createElement("div");
    this.host.id = ProgressBar.id;
    this.shadowRoot = this.host.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
<style>${ProgressBar.styles}</style>

<div class="container">
  <div class="track"></div>
  <div class="thumb"></div>
  <div class="progress"></div>
</div>
    `;
    this.container = this.shadowRoot.querySelector(".container")!;

    this.initEvents();
  }

  private seek(e: MouseEvent | PointerEvent) {
    const { left, width } = this.container.getBoundingClientRect();
    const progress = (e.clientX - left) / width;

    this.setProgress(progress);
    this.dispatchEvent(new CustomEvent("seek", { detail: progress }));
  }

  private initEvents() {
    let isPointerDown = false;

    this.container.addEventListener("pointerdown", (e) => {
      e.preventDefault();

      isPointerDown = true;
      this.dispatchEvent(new CustomEvent("seekstart"));
      this.seek(e);
    });

    this.container.addEventListener("pointermove", (e) => {
      isPointerDown && this.seek(e);
    });

    this.container.addEventListener("pointerup", () => {
      isPointerDown = false;
      this.dispatchEvent(new CustomEvent("seekend"));
    });
  }

  setStyle(styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.host.style, styles);
  }

  setProgress(progress: number) {
    this.host.style.setProperty("--progress", `${round(progress)}`);
  }

  render(container: HTMLElement) {
    container.appendChild(this.host);
  }
}

async function initProgressBar() {
  const renderer = await waitForElement("ytd-reel-video-renderer[is-active]");
  const video = (await waitForElement("video", {
    context: renderer,
  })) as HTMLVideoElement;

  const progressBar = new ProgressBar();
  progressBar.setStyle({
    width: "100%",
    position: "absolute",
    bottom: "0",
  });

  function timeUpdateListener() {
    progressBar.setProgress(video.currentTime / video.duration);
  }

  function arrowKeysListener(e: KeyboardEvent) {
    e.key === "ArrowRight" && (video.currentTime += 5);
    e.key === "ArrowLeft" && (video.currentTime -= 5);
  }

  document.addEventListener("keydown", arrowKeysListener);
  video.addEventListener("timeupdate", timeUpdateListener);
  progressBar.addEventListener("seekstart", () => video.pause());
  progressBar.addEventListener("seekend", () => video.play());
  progressBar.addEventListener("seek", (e) => {
    video.currentTime = video.duration * (e as CustomEvent).detail;
  });

  progressBar.render(renderer);

  return function cleanUp() {
    document.getElementById(ProgressBar.id)?.remove();
    document.removeEventListener("keydown", arrowKeysListener);
    video.removeEventListener("timeupdate", timeUpdateListener);
  };
}

let cleanUp: () => void;
async function init() {
  try {
    cleanUp = await initProgressBar();
  } catch {}
}

init();

document.addEventListener("yt-navigate-finish", async (e) => {
  cleanUp?.();

  const typedEvent = e as CustomEvent<{ pageType: string }>;
  if (typedEvent.detail.pageType !== "shorts") {
    return;
  }

  init();
});
