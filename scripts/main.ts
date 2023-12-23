const LOG_NS = "[Controlled shorts]";
const log = console.log.bind(console, LOG_NS);
const warn = console.warn.bind(console, LOG_NS);

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function isShortsPage() {
  return location.pathname.includes("/shorts/");
}

class ProgressBar extends EventTarget {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private container: HTMLElement;

  private isPointerDown = false;

  constructor() {
    super();
    this.host = document.createElement("div");
    this.shadow = this.host.attachShadow({ mode: "closed" });
    this.shadow.innerHTML = this.view();
    this.container = this.shadow.querySelector(".container")!;
  }

  setStyle(styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.host.style, styles);
  }

  setProgress(progress: number) {
    this.host.style.setProperty("--progress", `${round(progress)}`);
  }

  mount(node: HTMLElement, position: InsertPosition = "beforeend") {
    this.container.addEventListener("pointerdown", this.handlePointerDown);
    document.addEventListener("pointermove", this.handlePointerMove);
    node.insertAdjacentElement(position, this.host);
  }

  destroy() {
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    document.removeEventListener("pointermove", this.handlePointerMove);
    this.host.remove();
  }

  private seek = (e: MouseEvent | PointerEvent) => {
    const { left, width } = this.container.getBoundingClientRect();
    const relativeX = e.clientX - left;
    const progress = clamp(relativeX, 0, width) / width;

    this.setProgress(progress);
    this.dispatchEvent(new CustomEvent("seek", { detail: progress }));
  };

  private setIsPointerDown = (isPointerDown: boolean) => {
    this.isPointerDown = isPointerDown;
    if (isPointerDown) {
      this.container.classList.add("drag");
    } else {
      this.container.classList.remove("drag");
    }
  };

  private handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();

    this.setIsPointerDown(true);
    this.dispatchEvent(new CustomEvent("seekstart"));
    this.seek(e);

    document.addEventListener(
      "pointerup",
      () => {
        this.setIsPointerDown(false);
        this.dispatchEvent(new CustomEvent("seekend"));
      },
      { once: true }
    );
  };

  private handlePointerMove = (e: PointerEvent) => {
    this.isPointerDown && this.seek(e);
  };

  private view() {
    return `
<div class="container">
  <div class="track"></div>
  <div class="thumb"></div>
  <div class="progress"></div>
</div>

<style>
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
 
  .container .thumb {
    display: none;
  }
  
  .container.drag .thumb,
  .container:hover .thumb {
    display: block;
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
</style>
`;
  }
}

function initProgressBar(node: HTMLElement, video: HTMLVideoElement) {
  const progressBar = new ProgressBar();
  progressBar.setStyle({
    width: "100%",
    position: "absolute",
    bottom: "0",
    zIndex: "1",
  });

  function handleTimeUpdate() {
    progressBar.setProgress(video.currentTime / video.duration);
  }

  function handleSeekStart() {
    video.pause();
  }

  function handleSeekEnd() {
    video.play().catch(() => {
      // suppress error
      // may occur when user tries to seek in the very end of the video
      // probably conflicts with youtube's playback
    });
  }

  function handleSeek(e: Event) {
    video.currentTime = video.duration * (e as CustomEvent<number>).detail;
  }

  video.addEventListener("timeupdate", handleTimeUpdate);
  progressBar.addEventListener("seekstart", handleSeekStart);
  progressBar.addEventListener("seekend", handleSeekEnd);
  progressBar.addEventListener("seek", handleSeek);
  progressBar.mount(node);

  return function cleanUp() {
    video.removeEventListener("timeupdate", handleTimeUpdate);
    progressBar.removeEventListener("seekstart", handleSeekStart);
    progressBar.removeEventListener("seekend", handleSeekEnd);
    progressBar.removeEventListener("seek", handleSeek);
    progressBar.destroy();
  };
}

const POLL_INTERVAL = 100;
let cleanUp: () => void;
let initCheckInterval: number | undefined;

function init() {
  if (!isShortsPage()) {
    return;
  }

  const node = document.querySelector<HTMLElement>(
    "ytd-reel-video-renderer[is-active]"
  );
  const video = node?.querySelector("video");

  if (!node || !video) {
    return;
  }

  clearInterval(initCheckInterval);
  initCheckInterval = undefined;

  function handleKeydown(e: KeyboardEvent) {
    if (!video) return;
    e.key === "ArrowRight" && (video.currentTime += 5);
    e.key === "ArrowLeft" && (video.currentTime -= 5);
  }

  document.addEventListener("keydown", handleKeydown);
  const cleanUpAfterProgressBar = initProgressBar(node, video);

  cleanUp = () => {
    cleanUpAfterProgressBar();
    document.removeEventListener("keydown", handleKeydown);
  };
}

initCheckInterval = setInterval(init, POLL_INTERVAL);

document.addEventListener("yt-navigate-finish", () => {
  cleanUp?.();
  clearInterval(initCheckInterval);

  if (isShortsPage()) {
    initCheckInterval = setInterval(init, POLL_INTERVAL);
  }
});
