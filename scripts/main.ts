(async () => {
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

    const element = new Promise<HTMLElement>((resolve) => {
      intervalId = setInterval(() => {
        const element = context.querySelector<HTMLElement>(selector);

        if (element) {
          clearInterval(intervalId);
          resolve(element);
        }
      }, 100);
    });

    return Promise.race([element, timeout(limit) as never]).finally(() =>
      clearInterval(intervalId)
    );
  }

  function timeout(time: number) {
    return new Promise((_, reject) => setTimeout(reject, time));
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

    private host = document.createElement("div");
    private shadowRoot = this.host.attachShadow({ mode: "open" });

    constructor() {
      super();

      this.host.id = ProgressBar.id;
      this.shadowRoot.innerHTML = `
<style>${ProgressBar.styles}</style>

<div class="container">
  <div class="track"></div>
  <div class="thumb"></div>
  <div class="progress"></div>
</div>
    `;

      this.initEvents();
    }

    setStyle(styles: Partial<CSSStyleDeclaration>) {
      Object.assign(this.host.style, styles);
    }

    setProgress(progress: number) {
      this.host.style.setProperty("--progress", `${round(progress)}`);
    }

    initEvents() {
      const container = this.shadowRoot.querySelector(
        ".container"
      ) as HTMLElement;

      container.addEventListener("click", (e) => {
        const { left, width } = container.getBoundingClientRect();
        const progress = (e.clientX - left) / width;

        this.setProgress(progress);
        this.dispatchEvent(new CustomEvent("seek", { detail: progress }));
      });
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

    function seekListener(e: Event) {
      video.currentTime = video.duration * (e as CustomEvent).detail;
    }

    function arrowKeysListener(e: KeyboardEvent) {
      e.key === "ArrowRight" && (video.currentTime += 5);
      e.key === "ArrowLeft" && (video.currentTime -= 5);
    }

    document.addEventListener("keydown", arrowKeysListener);
    progressBar.addEventListener("seek", seekListener);
    video.addEventListener("timeupdate", timeUpdateListener);

    progressBar.render(renderer);

    return function cleanUp() {
      progressBar.removeEventListener("seek", seekListener);
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
})();
