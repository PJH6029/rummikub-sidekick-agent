type CaptureTarget = {
  element?: HTMLElement | null;
};

type CaptureResult = {
  imageDataUrl: string;
  displaySurface?: string;
};

let activeStream: MediaStream | null = null;
let activeVideo: HTMLVideoElement | null = null;

export async function captureScreenFrame(target: CaptureTarget = {}): Promise<CaptureResult> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("This browser does not support screen capture.");
  }

  const stream = await getActiveStream();
  const video = await getActiveVideo(stream);

  await waitForFrame();

  const trackSettings = stream.getVideoTracks()[0]?.getSettings();
  const width = video.videoWidth || trackSettings?.width || 1280;
  const height = video.videoHeight || trackSettings?.height || 720;
  const displaySurface = trackSettings?.displaySurface;
  if (target.element && displaySurface && displaySurface !== "browser") {
    stopActiveStream();
    throw new Error("Rummikub iframe만 캡처하려면 화면 공유에서 현재 Chrome 탭을 선택해야 합니다.");
  }
  const sourceRect = getSourceRect(width, height, target.element, displaySurface);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(sourceRect.width, sourceRect.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceRect.width * scale));
  canvas.height = Math.max(1, Math.round(sourceRect.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create screenshot canvas.");
  }

  context.drawImage(
    video,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return {
    imageDataUrl: canvas.toDataURL("image/jpeg", 0.86),
    displaySurface,
  };
}

async function getActiveStream(): Promise<MediaStream> {
  if (activeStream && activeStream.getVideoTracks().some((track) => track.readyState === "live")) {
    return activeStream;
  }

  cleanupStream();

  const displayMediaOptions = {
    video: {
      displaySurface: "browser",
      frameRate: { ideal: 5, max: 10 },
      height: { ideal: 1080 },
      width: { ideal: 1920 },
    },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  };

  try {
    activeStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions as DisplayMediaStreamOptions);
  } catch (error) {
    throw normalizeCaptureError(error);
  }
  for (const track of activeStream.getTracks()) {
    track.addEventListener("ended", cleanupStream, { once: true });
  }
  return activeStream;
}

async function getActiveVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  if (activeVideo && activeVideo.srcObject === stream && activeVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
    await activeVideo.play();
    return activeVideo;
  }

  activeVideo = document.createElement("video");
  activeVideo.muted = true;
  activeVideo.playsInline = true;
  activeVideo.srcObject = stream;

  await new Promise<void>((resolve, reject) => {
    activeVideo?.addEventListener("loadedmetadata", () => resolve(), { once: true });
    activeVideo?.addEventListener("error", () => reject(new Error("Could not read screen stream.")), { once: true });
  });
  await activeVideo.play();
  return activeVideo;
}

function getSourceRect(width: number, height: number, element?: HTMLElement | null, displaySurface?: string) {
  if (!element || displaySurface !== "browser") {
    return { x: 0, y: 0, width, height };
  }

  const rect = element.getBoundingClientRect();
  const scaleX = width / Math.max(1, window.innerWidth);
  const scaleY = height / Math.max(1, window.innerHeight);
  const x = clamp(Math.round(rect.left * scaleX), 0, width - 1);
  const y = clamp(Math.round(rect.top * scaleY), 0, height - 1);
  const right = clamp(Math.round(rect.right * scaleX), x + 1, width);
  const bottom = clamp(Math.round(rect.bottom * scaleY), y + 1, height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function cleanupStream() {
  activeVideo = null;
  activeStream = null;
}

function stopActiveStream() {
  for (const track of activeStream?.getTracks() ?? []) {
    track.stop();
  }
  cleanupStream();
}

function waitForFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeCaptureError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return new Error("화면 캡처 권한이 취소되었습니다. 훈수 받기를 다시 누르고 현재 Rummikub 탭을 공유하세요.");
    }

    if (error.name === "InvalidStateError") {
      return new Error("브라우저가 화면 캡처를 시작하지 못했습니다. Chrome에서 이 탭을 직접 활성화한 뒤 훈수 받기를 눌러 현재 탭을 공유하세요.");
    }
  }

  return error instanceof Error ? error : new Error("화면 캡처를 시작하지 못했습니다.");
}
