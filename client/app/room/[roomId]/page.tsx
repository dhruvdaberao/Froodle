"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Brush,
  Download,
  Eraser,
  Info,
  Link2,
  LogOut,
  MessageSquare,
  PaintBucket,
  Redo2,
  Shapes,
  Trash2,
  Undo2,
  Square,
  Circle,
  Triangle,
  Star,
  Slash,
  Smile,
  Sparkles,
  Lock,
  Globe,
  Users,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { SOCKET_EVENTS } from "@cloudcanvas/shared";
import type { BrushStyle, DrawingTool, ShapeKind } from "@cloudcanvas/shared";
import { CanvasBoard } from "@/components/canvas-board";
import { ColorWheelPicker } from "@/components/color-wheel-picker";
import { ConfirmModal } from "@/components/confirm-modal";
import { ToastStack, type ToastMessage } from "@/components/toast";
import { Button, Card, SecondaryButton } from "@/components/ui";
import { getSocket } from "@/lib/socket";
import { useRoomSocket } from "@/hooks/use-room-socket";
import { getRoom, joinRoom } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import {
  grantRoomAccess,
  hasRoomAccessGrant,
  revokeRoomAccess,
} from "@/lib/room-access";
import {
  clearRoomEntryHint,
  readRoomEntryHint,
  rememberRoomPageHint,
} from "@/lib/room-entry";
import {
  beginRoomOrientationSession,
  cancelRoomOrientationSession,
  enforcePortraitMode,
  exitRoomOrientation,
  isRoomOrientationSessionActive,
  ROOM_VIEWPORT_HEIGHT_VAR,
  ROOM_VIEWPORT_WIDTH_VAR,
  ROOM_PAGE_ACTIVE_CLASS,
  ROOM_PAGE_LANDSCAPE_CLASS,
} from "@/lib/room-orientation";
import {
  ensureGuestDisplayName,
  getAvatarInitials,
  resolveSessionDisplayName,
} from "@/lib/guest";

const REACTIONS = [
  { emoji: "❤️", label: "Appreciate" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "😮", label: "Surprised" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "🎉", label: "Celebrate" },
] as const;

const BRUSH_OPTIONS: Array<{ id: BrushStyle; label: string }> = [
  { id: "classic", label: "Classic" },
  { id: "crayon", label: "Crayon" },
  { id: "neon", label: "Neon" },
  { id: "spray", label: "Spray" },
  { id: "dotted", label: "Dotted" },
];

const SHAPE_OPTIONS: Array<{
  tool: ShapeKind;
  label: string;
  icon: typeof Square;
}> = [
  { tool: "line", label: "Line", icon: Slash },
  { tool: "rectangle", label: "Rectangle", icon: Square },
  { tool: "square", label: "Square", icon: Square },
  { tool: "circle", label: "Circle", icon: Circle },
  { tool: "ellipse", label: "Ellipse", icon: Circle },
  { tool: "triangle", label: "Triangle", icon: Triangle },
  { tool: "star", label: "Star", icon: Star },
];

const PRESET_COLORS = [
  "#111111",
  "#ffd84d",
  "#1c7dd7",
  "#ff5d5d",
  "#1fb76a",
  "#fb923c",
  "#ec4899",
  "#fff7df",
];

const MOBILE_WORKSPACE_MAX_WIDTH = 1366;

const getInitialViewportState = () => {
  if (typeof window === "undefined") {
    return {
      isTouchWorkspace: false,
      isPortraitViewport: false,
    };
  }

  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const viewportWidth = Math.round(
    window.visualViewport?.width ?? window.innerWidth,
  );
  const viewportHeight = Math.round(
    window.visualViewport?.height ?? window.innerHeight,
  );

  return {
    isTouchWorkspace:
      coarsePointer && window.innerWidth <= MOBILE_WORKSPACE_MAX_WIDTH,
    isPortraitViewport: viewportHeight > viewportWidth,
  };
};

const canOpenRoomImmediately = (
  hint: ReturnType<typeof readRoomEntryHint> | null,
) =>
  Boolean(
    hint && (hint.visibility !== "private" || hasRoomAccessGrant(hint.roomId)),
  );

type ToolPanel =
  | "brush"
  | "eraser"
  | "fill"
  | "shapes"
  | "reactions"
  | "info"
  | null;
type FunctionPanel = "chat" | null;
type ColorPickerTarget = "stroke" | "fill" | null;

const sidebarShell =
  "overflow-y-auto no-scrollbar overscroll-contain rounded-[20px] sm:rounded-[24px] border border-black/5 bg-white/78 p-1 sm:p-1.5 shadow-[0_16px_38px_rgba(15,23,42,0.12)] backdrop-blur-xl";
const desktopRailColumn =
  "min-[960px]:justify-between min-[960px]:gap-4 min-[960px]:py-3";
const desktopRailGroup =
  "flex w-full flex-col items-center gap-1 sm:gap-1.5 min-[960px]:flex-1 min-[960px]:justify-evenly";
const railButtonBase =
  "group inline-flex shrink-0 h-10 w-10 sm:h-12 sm:w-12 touch-manipulation select-none items-center justify-center rounded-[16px] sm:rounded-[18px] border border-black/5 bg-white/92 text-[color:var(--text-main)] shadow-[0_6px_16px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:bg-[color:var(--surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-blue)]/35 disabled:cursor-not-allowed disabled:opacity-40";
const floatingPanelCard =
  "rounded-[20px] border border-black/5 bg-white/95 p-3 shadow-[0_22px_44px_rgba(15,23,42,0.18)] backdrop-blur-xl";
const floatingPanelBody =
  "room-panel-scroll pr-1 [-ms-overflow-style:none] [scrollbar-width:thin] touch-pan-y";
const controlLabel =
  "text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]";
const railBadge =
  "absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--brand-blue)] px-1 text-[10px] font-bold text-white shadow-sm";
const panelCard =
  "rounded-[20px] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,251,255,0.98))] p-3 shadow-[0_10px_24px_rgba(15,23,42,0.08)]";
const compactSwatchButton =
  "relative h-10 w-10 rounded-full border border-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition hover:-translate-y-0.5";
const customColorButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-3.5 text-sm font-semibold text-[color:var(--text-main)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[color:var(--surface-soft)]";

export default function RoomPage() {
  const params = useParams<{ roomId?: string | string[] }>();
  const router = useRouter();
  const roomId = useMemo(() => {
    const candidate = Array.isArray(params.roomId)
      ? params.roomId[0]
      : params.roomId;
    return typeof candidate === "string" ? candidate.trim().toUpperCase() : "";
  }, [params.roomId]);
  const isValidRoomId = /^[A-Z0-9]{6}$/.test(roomId);
  const [tool, setTool] = useState<DrawingTool>("pen");
  const [brushStyle, setBrushStyle] = useState<BrushStyle>("classic");
  const [strokeColor, setStrokeColor] = useState("#111111");
  const [fillColor, setFillColor] = useState("#7dd3fc");
  const [fillEnabled, setFillEnabled] = useState(false);
  const [recentColors, setRecentColors] = useState<string[]>(["#111111"]);
  const [size, setSize] = useState(4);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("Guest");
  const roomEntryHint = useMemo(() => readRoomEntryHint(roomId), [roomId]);
  const [roomReady, setRoomReady] = useState(() =>
    canOpenRoomImmediately(roomEntryHint),
  );
  const [roomMeta, setRoomMeta] = useState<{
    roomId: string;
    name: string;
    visibility: "public" | "private";
  } | null>(() =>
    roomEntryHint
      ? {
          roomId: roomEntryHint.roomId,
          name: roomEntryHint.name,
          visibility: roomEntryHint.visibility,
        }
      : null,
  );
  const [roomLoadError, setRoomLoadError] = useState<string | null>(null);
  const [isRoomLoading, setIsRoomLoading] = useState(
    () => !canOpenRoomImmediately(roomEntryHint),
  );
  const [privateRoomPassword, setPrivateRoomPassword] = useState("");
  const [privateRoomError, setPrivateRoomError] = useState<string | null>(null);
  const [isUnlockingPrivateRoom, setIsUnlockingPrivateRoom] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [reactionBursts, setReactionBursts] = useState<
    Array<{ id: string; emoji: string; left: number }>
  >([]);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [isTouchWorkspace, setIsTouchWorkspace] = useState(
    () => getInitialViewportState().isTouchWorkspace,
  );
  const [isPortraitViewport, setIsPortraitViewport] = useState(
    () => getInitialViewportState().isPortraitViewport,
  );
  const [activeToolPanel, setActiveToolPanel] = useState<ToolPanel>("brush");
  const [activeFunctionPanel, setActiveFunctionPanel] =
    useState<FunctionPanel>(null);
  const [isBoardSurfaceReady, setIsBoardSurfaceReady] = useState(false);
  const [activeColorPicker, setActiveColorPicker] =
    useState<ColorPickerTarget>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const joinedToastShownRef = useRef(false);
  const toolPanelRef = useRef<HTMLDivElement | null>(null);
  const functionPanelRef = useRef<HTMLDivElement | null>(null);
  const orientationSessionRef = useRef(0);
  const isRoomOrientationActiveRef = useRef(true);
  const historyGuardEnabledRef = useRef(false);
  const historyGuardTokenRef = useRef(0);
  const returnPathRef = useRef("/");
  const { user } = useAuth();

  const pushToast = useCallback((message: string) => {
    const id = nanoid();
    setToasts((prev) => [...prev, { id, message }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((toast) => toast.id !== id)),
      1900,
    );
  }, []);

  const rememberColor = useCallback(
    (value: string) =>
      setRecentColors((prev) =>
        [value, ...prev.filter((item) => item !== value)].slice(0, 6),
      ),
    [],
  );
  const updateStrokeColor = useCallback(
    (value: string) => {
      setStrokeColor(value);
      rememberColor(value);
    },
    [rememberColor],
  );
  const updateFillColor = useCallback(
    (value: string) => {
      setFillColor(value);
      rememberColor(value);
    },
    [rememberColor],
  );

  useEffect(() => {
    if (!roomEntryHint) return;
    setRoomMeta({
      roomId: roomEntryHint.roomId,
      name: roomEntryHint.name,
      visibility: roomEntryHint.visibility,
    });
    setIsRoomLoading(false);
    setRoomReady(canOpenRoomImmediately(roomEntryHint));
  }, [roomEntryHint]);

  useEffect(() => {
    const existing =
      localStorage.getItem("froodle-user-id") ??
      localStorage.getItem("cloudcanvas-user-id");
    if (existing) setUserId(existing);
    else {
      const next = crypto.randomUUID();
      localStorage.setItem("froodle-user-id", next);
      setUserId(next);
    }
    localStorage.removeItem("cloudcanvas-user-id");
    setDisplayName(
      user?.role === "guest"
        ? ensureGuestDisplayName()
        : resolveSessionDisplayName(user),
    );
  }, [user?.username, user]);

  useEffect(() => {
    if (!roomId) {
      setRoomLoadError("Missing room code.");
      setRoomReady(false);
      setRoomMeta(null);
      setIsRoomLoading(false);
      return;
    }
    if (!isValidRoomId) {
      setRoomLoadError("Invalid room code.");
      setRoomReady(false);
      setRoomMeta(null);
      setIsRoomLoading(false);
      return;
    }
    let cancelled = false;
    const canUseEntryHint = canOpenRoomImmediately(roomEntryHint);
    setRoomLoadError(null);
    setRoomReady((current) => current || canUseEntryHint);
    setIsRoomLoading(!canUseEntryHint);
    getRoom(roomId)
      .then((data) => {
        if (cancelled) return;
        rememberRoomPageHint(data.room);
        setRoomMeta(data.room);
        if (
          data.room.visibility === "private" &&
          !hasRoomAccessGrant(data.room.roomId)
        )
          setRoomReady(false);
        else setRoomReady(true);
        setIsRoomLoading(false);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        console.error("[room-page] failed to load room", { roomId, error });
        setRoomMeta(null);
        setRoomLoadError(error.message || "Unable to load room.");
        setRoomReady(false);
        setIsRoomLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomEntryHint, roomId, isValidRoomId]);

  useEffect(() => {
    joinedToastShownRef.current = false;
    setIsBoardSurfaceReady(false);
    setRoomLoadError(null);
    setPrivateRoomError(null);
    setPrivateRoomPassword("");
  }, [roomId]);

  useEffect(() => {
    if (roomMeta?.visibility !== "private") {
      setPrivateRoomPassword("");
      setPrivateRoomError(null);
      return;
    }
    if (hasRoomAccessGrant(roomMeta.roomId)) {
      setPrivateRoomError(null);
      setRoomReady(true);
      return;
    }
    setRoomReady(false);
  }, [roomMeta]);

  const syncViewportState = useCallback(() => {
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const compactViewport = window.innerWidth <= MOBILE_WORKSPACE_MAX_WIDTH;
    const touchWorkspace = coarsePointer && compactViewport;
    const viewportWidth = Math.round(
      window.visualViewport?.width ?? window.innerWidth,
    );
    const viewportHeight = Math.round(
      window.visualViewport?.height ?? window.innerHeight,
    );
    setIsTouchWorkspace(touchWorkspace);
    setIsPortraitViewport(viewportHeight > viewportWidth);
    document.documentElement.style.setProperty(
      ROOM_VIEWPORT_HEIGHT_VAR,
      `${viewportHeight}px`,
    );
    document.documentElement.style.setProperty(
      ROOM_VIEWPORT_WIDTH_VAR,
      `${viewportWidth}px`,
    );
  }, []);

  useLayoutEffect(() => {
    syncViewportState();
  }, [syncViewportState]);

  useEffect(() => {
    const handleViewportChange = () => {
      syncViewportState();
    };

    handleViewportChange();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    window.addEventListener("focus", handleViewportChange);
    window.addEventListener("pageshow", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      window.removeEventListener("focus", handleViewportChange);
      window.removeEventListener("pageshow", handleViewportChange);
      window.visualViewport?.removeEventListener(
        "resize",
        handleViewportChange,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        handleViewportChange,
      );
    };
  }, [syncViewportState]);

  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty(ROOM_VIEWPORT_HEIGHT_VAR);
      document.documentElement.style.removeProperty(ROOM_VIEWPORT_WIDTH_VAR);
    };
  }, []);

  const isLandscapeWorkspaceOnly = isTouchWorkspace;
  const shouldRotateWorkspace = isLandscapeWorkspaceOnly && isPortraitViewport;

  useEffect(() => {
    isRoomOrientationActiveRef.current = true;
    orientationSessionRef.current = beginRoomOrientationSession();

    return () => {
      isRoomOrientationActiveRef.current = false;
      cancelRoomOrientationSession(orientationSessionRef.current);
    };
  }, []);

  const exitLandscapeWorkspaceMode = useCallback(async () => {
    isRoomOrientationActiveRef.current = false;
    cancelRoomOrientationSession(orientationSessionRef.current);
    await exitRoomOrientation(roomId);
  }, [roomId]);

  const requestLandscapeWorkspaceMode = useCallback(async () => {
    if (!isLandscapeWorkspaceOnly || !isRoomOrientationActiveRef.current)
      return;

    const sessionToken = orientationSessionRef.current;
    document.documentElement.classList.add(ROOM_PAGE_ACTIVE_CLASS);
    document.body.classList.add(ROOM_PAGE_ACTIVE_CLASS);
    document.documentElement.classList.add(ROOM_PAGE_LANDSCAPE_CLASS);
    document.body.classList.add(ROOM_PAGE_LANDSCAPE_CLASS);
    document.documentElement.dataset.roomRotated = shouldRotateWorkspace
      ? "true"
      : "false";
    document.body.dataset.roomRotated = shouldRotateWorkspace
      ? "true"
      : "false";
    document.documentElement.dataset.roomOrientationOwner = roomId;
    document.body.dataset.roomOrientationOwner = roomId;

    const root = document.documentElement;
    const requestFullscreenTarget = document.body;

    try {
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        requestFullscreenTarget.dataset.roomFullscreenOwner = roomId;
        await requestFullscreenTarget.requestFullscreen({
          navigationUI: "hide",
        });
      }
    } catch (error) {
      delete requestFullscreenTarget.dataset.roomFullscreenOwner;
      console.info("[room-page] fullscreen request skipped", { roomId, error });
    }

    if (
      !isRoomOrientationActiveRef.current ||
      !isRoomOrientationSessionActive(sessionToken)
    ) {
      return;
    }

    try {
      if (typeof screen !== "undefined" && "orientation" in screen) {
        const orientation = screen.orientation as ScreenOrientation & {
          lock?: (orientation: "landscape") => Promise<void>;
        };
        await orientation.lock?.("landscape");
      }
    } catch (error) {
      console.info("[room-page] orientation lock skipped", { roomId, error });
    }

    if (
      !isRoomOrientationActiveRef.current ||
      !isRoomOrientationSessionActive(sessionToken)
    ) {
      return;
    }

    root.style.setProperty("overscroll-behavior", "none");
  }, [isLandscapeWorkspaceOnly, roomId, shouldRotateWorkspace]);

  useLayoutEffect(() => {
    if (!isLandscapeWorkspaceOnly) {
      void exitLandscapeWorkspaceMode();
      return;
    }

    void requestLandscapeWorkspaceMode();
  }, [
    exitLandscapeWorkspaceMode,
    isLandscapeWorkspaceOnly,
    requestLandscapeWorkspaceMode,
  ]);

  useEffect(() => {
    if (!isLandscapeWorkspaceOnly) return;

    const reassertLandscapeWorkspace = () => {
      void requestLandscapeWorkspaceMode();
    };

    window.addEventListener("focus", reassertLandscapeWorkspace);
    window.addEventListener("pageshow", reassertLandscapeWorkspace);
    document.addEventListener("visibilitychange", reassertLandscapeWorkspace);
    document.addEventListener("fullscreenchange", reassertLandscapeWorkspace);

    return () => {
      window.removeEventListener("focus", reassertLandscapeWorkspace);
      window.removeEventListener("pageshow", reassertLandscapeWorkspace);
      document.removeEventListener(
        "visibilitychange",
        reassertLandscapeWorkspace,
      );
      document.removeEventListener(
        "fullscreenchange",
        reassertLandscapeWorkspace,
      );
    };
  }, [isLandscapeWorkspaceOnly, requestLandscapeWorkspaceMode]);

  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("overscroll-behavior");
      void enforcePortraitMode();
    };
  }, []);

  useEffect(() => {
    if (!roomId || !userId || !isValidRoomId) return;
    const socket = getSocket();
    if (!socket.connected && !socket.active) {
      socket.connect();
    }
  }, [isValidRoomId, roomId, userId]);

  const avatarUrl = user?.profileImage;
  const {
    participants,
    strokes,
    setStrokes,
    chatMessages,
    cursors,
    status,
    expired,
    error,
    hasJoined,
    leaveRoom: leaveSocketRoom,
    undoStroke,
    redoStroke,
    redoCount,
  } = useRoomSocket(
    roomReady ? roomId : "",
    roomReady ? userId : "",
    displayName,
    avatarUrl,
  );

  useEffect(() => {
    if (!chatEndRef.current || activeFunctionPanel !== "chat") return;
    chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeFunctionPanel, chatMessages]);

  const canUndo = strokes.some((stroke) => stroke.userId === userId);
  const canRedo = redoCount > 0;
  const isShapeTool = SHAPE_OPTIONS.some((shape) => shape.tool === tool);
  const roomTitle = roomMeta?.name || `Room ${roomId}`;

  const boardLayoutReadySignal = useMemo(
    () =>
      [
        roomId,
        roomReady ? "ready" : "locked",
        isTouchWorkspace ? "touch" : "pointer",
        shouldRotateWorkspace ? "rotated-landscape" : "landscape",
      ].join(":"),
    [isTouchWorkspace, roomId, roomReady, shouldRotateWorkspace],
  );

  const isBoardInitializing = roomReady && (!hasJoined || !isBoardSurfaceReady);
  const connectionMessage =
    error ||
    (status === "connecting" && "Connecting to the collaboration server…") ||
    (status === "reconnecting" &&
      "Realtime connection dropped. Trying to reconnect…") ||
    (status === "disconnected" &&
      "Realtime connection is offline right now. We’ll reconnect automatically when possible.") ||
    null;

  const closeFloatingPanels = useCallback(
    (options: { keep?: "tool" | "function" | null } = {}) => {
      if (options.keep !== "tool") setActiveToolPanel(null);
      if (options.keep !== "function") setActiveFunctionPanel(null);
    },
    [],
  );

  useEffect(() => {
    if (tool === "pen") setActiveToolPanel("brush");
    else if (tool === "eraser") setActiveToolPanel("eraser");
    else if (tool === "fill") setActiveToolPanel("fill");
    else if (isShapeTool) setActiveToolPanel("shapes");
  }, [isShapeTool, tool]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (toolPanelRef.current?.contains(target)) return;
      if (functionPanelRef.current?.contains(target)) return;
      closeFloatingPanels();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeFloatingPanels]);

  const clearBoard = () => {
    getSocket().emit(SOCKET_EVENTS.BOARD_CLEAR, { roomId });
    setStrokes([]);
    setIsClearModalOpen(false);
    pushToast("Board cleared for a fresh start.");
  };

  const download = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = (canvas as HTMLCanvasElement).width;
    exportCanvas.height = (canvas as HTMLCanvasElement).height + 50;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(canvas as HTMLCanvasElement, 0, 0);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("Made on Froddle", 16, exportCanvas.height - 14);
    const link = document.createElement("a");
    link.download = `froddle-${roomId}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  };

  const sendChat = () => {
    const text = chatDraft.trim();
    if (!text) return;
    getSocket().emit(SOCKET_EVENTS.CHAT_SEND, {
      roomId,
      userId,
      displayName,
      avatarUrl,
      text: text.slice(0, 240),
    });
    setChatDraft("");
  };

  const pushReactionBurst = useCallback((id: string, emoji: string) => {
    setReactionBursts((prev) => {
      if (prev.some((burst) => burst.id === id)) return prev;
      return [
        ...prev,
        { id, emoji, left: Math.floor(Math.random() * 80) + 10 },
      ];
    });
    window.setTimeout(
      () =>
        setReactionBursts((prev) => prev.filter((burst) => burst.id !== id)),
      2300,
    );
  }, []);

  const sendReaction = (emoji: (typeof REACTIONS)[number]["emoji"]) => {
    getSocket().emit(SOCKET_EVENTS.REACTION_SEND, {
      roomId,
      userId,
      displayName,
      emoji,
    });
  };

  useEffect(() => {
    const onReaction = ({
      emoji,
      reactionId,
    }: {
      emoji: string;
      reactionId: string;
    }) => {
      pushReactionBurst(reactionId, emoji);
    };
    getSocket().on(SOCKET_EVENTS.REACTION_EVENT, onReaction);
    return () => {
      getSocket().off(SOCKET_EVENTS.REACTION_EVENT, onReaction);
    };
  }, [pushReactionBurst]);

  useEffect(() => {
    if (!hasJoined || joinedToastShownRef.current) return;
    pushToast(`Joined room ${roomId}.`);
    joinedToastShownRef.current = true;
  }, [hasJoined, pushToast, roomId]);

  useEffect(() => {
    const onParticipantJoined = ({
      participant,
    }: {
      participant: { displayName: string };
    }) => pushToast(`${participant.displayName} joined the room.`);
    const onParticipantLeft = ({
      participant,
    }: {
      participant: { displayName: string };
    }) => pushToast(`${participant.displayName} left the room.`);
    getSocket().on(SOCKET_EVENTS.ROOM_PARTICIPANT_JOINED, onParticipantJoined);
    getSocket().on(SOCKET_EVENTS.ROOM_PARTICIPANT_LEFT, onParticipantLeft);
    return () => {
      getSocket().off(
        SOCKET_EVENTS.ROOM_PARTICIPANT_JOINED,
        onParticipantJoined,
      );
      getSocket().off(SOCKET_EVENTS.ROOM_PARTICIPANT_LEFT, onParticipantLeft);
    };
  }, [pushToast]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const referrer = document.referrer;
    if (!referrer) return;

    try {
      const nextUrl = new URL(referrer);
      if (nextUrl.origin !== window.location.origin) return;
      if (nextUrl.pathname.startsWith("/room/")) return;
      returnPathRef.current =
        `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` || "/";
    } catch {
      // noop
    }
  }, []);

  const navigateOutOfRoom = useCallback(() => {
    const fallbackPath = returnPathRef.current || "/";
    clearRoomEntryHint(roomId);
    router.replace(fallbackPath);
  }, [roomId, router]);

  const leaveRoomSafely = useCallback(async () => {
    historyGuardEnabledRef.current = false;
    closeFloatingPanels();
    leaveSocketRoom();
    revokeRoomAccess(roomId);
    setIsExitModalOpen(false);
    await enforcePortraitMode();
    navigateOutOfRoom();
  }, [closeFloatingPanels, leaveSocketRoom, navigateOutOfRoom, roomId]);

  useEffect(() => {
    if (!roomReady || typeof window === "undefined") return;

    historyGuardTokenRef.current += 1;
    const token = historyGuardTokenRef.current;
    historyGuardEnabledRef.current = true;
    window.history.pushState(
      { roomExitGuard: roomId, token },
      "",
      window.location.href,
    );

    const handlePopState = () => {
      if (!historyGuardEnabledRef.current) return;
      window.history.pushState(
        { roomExitGuard: roomId, token },
        "",
        window.location.href,
      );
      setIsExitModalOpen(true);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      historyGuardEnabledRef.current = false;
      window.removeEventListener("popstate", handlePopState);
    };
  }, [roomId, roomReady]);

  const unlockPrivateRoom = useCallback(async () => {
    if (!roomMeta || roomMeta.visibility !== "private") return;
    const password = privateRoomPassword.trim();
    if (!password) {
      setPrivateRoomError("Enter the room password to continue.");
      return;
    }
    try {
      setIsUnlockingPrivateRoom(true);
      setPrivateRoomError(null);
      const response = await joinRoom({
        name: roomMeta.roomId,
        visibility: "private",
        password,
        guestDisplayName:
          user?.role === "guest"
            ? ensureGuestDisplayName(displayName)
            : undefined,
      });
      grantRoomAccess(roomMeta.roomId);
      rememberRoomPageHint({
        roomId: response.room.roomId,
        name: response.room.name,
        visibility: response.room.visibility,
        createdAt: response.room.createdAt,
        updatedAt: response.room.updatedAt,
        lastActiveAt: response.room.lastActiveAt,
        expiresAt: null,
      });
      setRoomReady(true);
      setPrivateRoomPassword("");
      pushToast(`Unlocked private room ${roomMeta.roomId}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to unlock room.";
      setPrivateRoomError(message);
    } finally {
      setIsUnlockingPrivateRoom(false);
    }
  }, [privateRoomPassword, pushToast, roomMeta]);

  const openToolPanel = (panel: Exclude<ToolPanel, null>) => {
    setActiveFunctionPanel(null);
    setActiveToolPanel((current) => (current === panel ? null : panel));
  };

  const openColorPicker = useCallback(
    (target: Exclude<ColorPickerTarget, null>) => {
      setActiveToolPanel(null);
      setActiveFunctionPanel(null);
      setActiveColorPicker(target);
    },
    [],
  );

  const closeColorPicker = useCallback(() => {
    setActiveColorPicker(null);
  }, []);

  const applyCustomColor = useCallback(
    (value: string) => {
      if (activeColorPicker === "fill") updateFillColor(value);
      else updateStrokeColor(value);
      setActiveColorPicker(null);
    },
    [activeColorPicker, updateFillColor, updateStrokeColor],
  );

  const visibleColorSwatches = useMemo(
    () =>
      [
        ...recentColors,
        ...PRESET_COLORS.filter((color) => !recentColors.includes(color)),
      ].slice(0, 8),
    [recentColors],
  );

  const renderColorSwatches = useCallback(
    ({
      selectedColor,
      onSelect,
      onCustom,
      customLabel,
    }: {
      selectedColor: string;
      onSelect: (value: string) => void;
      onCustom: () => void;
      customLabel: string;
    }) => (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="h-11 w-11 rounded-full border border-black/10 shadow-[0_6px_16px_rgba(15,23,42,0.12)]"
              style={{ backgroundColor: selectedColor }}
            />
            <div>
              <p className="text-sm font-semibold text-[color:var(--text-main)]">
                {selectedColor.toUpperCase()}
              </p>
              <p className="text-xs text-[color:var(--text-muted)]">
                Tap a swatch or open the custom wheel.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCustom}
            className={customColorButton}
          >
            <Sparkles size={14} /> {customLabel}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {visibleColorSwatches.map((color) => {
            const selected =
              selectedColor.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                className={`${compactSwatchButton} ${selected ? "ring-2 ring-[color:var(--text-main)] ring-offset-2 ring-offset-white" : ""}`}
                style={{ backgroundColor: color }}
                onClick={() => onSelect(color)}
                aria-label={`Select color ${color}`}
              />
            );
          })}
        </div>
      </div>
    ),
    [visibleColorSwatches],
  );

  const renderSizePreview = useCallback(
    ({
      mode,
      currentSize,
      colorValue,
    }: {
      mode: "brush" | "eraser";
      currentSize: number;
      colorValue?: string;
    }) => {
      const diameter = Math.max(10, Math.min(56, currentSize * 2));
      const isBrushPreview = mode === "brush";
      return (
        <div className={`${panelCard} flex items-center gap-3`}>
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-[18px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),rgba(226,238,248,0.9))]">
            <span
              className={`rounded-full border ${isBrushPreview ? "border-black/10" : "border-dashed border-slate-400 bg-white/40"}`}
              style={{
                width: diameter,
                height: diameter,
                backgroundColor: isBrushPreview
                  ? colorValue
                  : "rgba(255,255,255,0.25)",
                boxShadow: isBrushPreview
                  ? "0 8px 18px rgba(15,23,42,0.16)"
                  : "inset 0 0 0 1px rgba(148,163,184,0.4)",
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[color:var(--text-main)]">
              {isBrushPreview ? "Live stroke size" : "Live erase area"}
            </p>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">
              {isBrushPreview
                ? "Matches your active brush thickness so strokes feel predictable."
                : "Shows the footprint removed on contact before you erase."}
            </p>
            {isBrushPreview ? (
              <div className="mt-3 overflow-hidden rounded-full bg-white/80 px-3 py-3 shadow-inner">
                <div
                  className="rounded-full"
                  style={{
                    height: Math.max(2, Math.min(18, currentSize)),
                    backgroundColor: colorValue,
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      );
    },
    [],
  );

  const renderToolPanelContent = () => {
    if (activeToolPanel === "brush")
      return (
        <div className="space-y-4">
          <div>
            <p className={controlLabel}>Brush style</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BRUSH_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${brushStyle === option.id ? "border-transparent bg-[color:var(--brand-blue)] text-white shadow-[0_10px_22px_rgba(25,167,255,0.24)]" : "border-black/5 bg-[color:var(--bg-elevated)] hover:bg-[color:var(--surface-soft)]"}`}
                  onClick={() => {
                    setTool("pen");
                    setBrushStyle(option.id);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={panelCard}>
            <div className="flex items-center justify-between gap-3">
              <p className={controlLabel}>Thickness</p>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold shadow-sm">
                {size}px
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={24}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="mt-3 w-full accent-[color:var(--brand-blue)]"
            />
          </div>

          {renderSizePreview({
            mode: "brush",
            currentSize: size,
            colorValue: strokeColor,
          })}

          <div>
            <p className={controlLabel}>Stroke color</p>
            <div className="mt-2">
              {renderColorSwatches({
                selectedColor: strokeColor,
                onSelect: updateStrokeColor,
                onCustom: () => openColorPicker("stroke"),
                customLabel: "Custom",
              })}
            </div>
          </div>
        </div>
      );
    if (activeToolPanel === "eraser")
      return (
        <div className="space-y-4">
          <div className={panelCard}>
            <div className="flex items-center justify-between gap-3">
              <p className={controlLabel}>Eraser size</p>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold shadow-sm">
                {size}px
              </span>
            </div>
            <input
              type="range"
              min={4}
              max={32}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="mt-3 w-full accent-[color:var(--brand-blue)]"
            />
          </div>
          {renderSizePreview({ mode: "eraser", currentSize: size })}
          <div className="rounded-[18px] bg-[color:var(--bg-elevated)] p-3 text-sm text-[color:var(--text-muted)]">
            Eraser strokes stay on the same lightweight input path as brush
            strokes, so switching tools remains fast and stable.
          </div>
        </div>
      );
    if (activeToolPanel === "fill")
      return (
        <div className="space-y-4">
          <div>
            <p className={controlLabel}>Fill color</p>
            <div className="mt-2">
              {renderColorSwatches({
                selectedColor: fillColor,
                onSelect: updateFillColor,
                onCustom: () => openColorPicker("fill"),
                customLabel: "Custom",
              })}
            </div>
          </div>
        </div>
      );
    if (activeToolPanel === "shapes")
      return (
        <div className="space-y-4">
          <div>
            <p className={controlLabel}>Choose a shape</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {SHAPE_OPTIONS.map(({ tool: shapeTool, label, icon: Icon }) => (
                <button
                  key={shapeTool}
                  type="button"
                  className={`flex items-center gap-2 rounded-[18px] border px-3 py-2 text-sm font-semibold transition ${tool === shapeTool ? "border-transparent bg-[color:var(--brand-blue)] text-white shadow-[0_10px_22px_rgba(25,167,255,0.24)]" : "border-black/5 bg-[color:var(--bg-elevated)] hover:bg-[color:var(--surface-soft)]"}`}
                  onClick={() => setTool(shapeTool)}
                >
                  <Icon size={15} /> <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-[18px] bg-[color:var(--bg-elevated)] px-3 py-3 text-sm text-[color:var(--text-main)]">
            <div>
              <p className="font-semibold">Fill closed shapes</p>
              <p className="text-xs text-[color:var(--text-muted)]">
                Use the selected fill color for supported shapes.
              </p>
            </div>
            <input
              type="checkbox"
              checked={fillEnabled}
              onChange={(e) => setFillEnabled(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
          <div className="grid gap-3">
            <div className={panelCard}>
              <p className={controlLabel}>Stroke color</p>
              <div className="mt-2">
                {renderColorSwatches({
                  selectedColor: strokeColor,
                  onSelect: updateStrokeColor,
                  onCustom: () => openColorPicker("stroke"),
                  customLabel: "Custom",
                })}
              </div>
            </div>
            <div className={panelCard}>
              <p className={controlLabel}>Fill color</p>
              <div className="mt-2">
                {renderColorSwatches({
                  selectedColor: fillColor,
                  onSelect: updateFillColor,
                  onCustom: () => openColorPicker("fill"),
                  customLabel: "Custom",
                })}
              </div>
            </div>
          </div>
        </div>
      );
    if (activeToolPanel === "reactions")
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-2">
            {REACTIONS.map(({ emoji, label }) => (
              <button
                key={emoji}
                type="button"
                className="flex aspect-square items-center justify-center rounded-2xl border border-black/5 bg-[color:var(--bg-elevated)] text-2xl transition hover:-translate-y-0.5 hover:bg-[color:var(--surface-soft)]"
                onClick={() => sendReaction(emoji)}
                title={label}
                aria-label={label}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      );
    if (activeToolPanel === "info")
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-black text-[color:var(--text-main)]">
              {roomTitle}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-muted)]">
              <span className="rounded-full bg-[color:var(--bg-elevated)] px-2 py-1 font-semibold uppercase tracking-[0.14em]">
                {roomId}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--bg-elevated)] px-2 py-1 font-semibold capitalize">
                {roomMeta?.visibility === "private" ? (
                  <Lock size={12} />
                ) : (
                  <Globe size={12} />
                )}
                {roomMeta?.visibility ?? "public"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--bg-elevated)] px-2 py-1 font-semibold">
                <Users size={12} /> {participants.length}
              </span>
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className={controlLabel}>Participants</p>
              <button
                type="button"
                className="text-xs font-semibold text-[color:var(--brand-blue)]"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  pushToast("Room link copied.");
                }}
              >
                Copy link
              </button>
            </div>
            <div className="space-y-2">
              {participants.map((participant) => (
                <div
                  key={participant.socketId}
                  className="flex items-center gap-3 rounded-[16px] bg-[color:var(--bg-elevated)] px-3 py-2.5"
                >
                  <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-black/5 bg-white text-xs font-semibold text-[color:var(--text-main)]">
                    {participant.avatarUrl ? (
                      <img
                        src={participant.avatarUrl}
                        alt={participant.displayName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      getAvatarInitials(participant.displayName)
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[color:var(--text-main)]">
                      {participant.displayName}
                    </p>
                    <p className="text-xs text-[color:var(--text-muted)]">
                      {participant.userId === userId ? "You" : "Connected"}
                    </p>
                  </div>
                  <span
                    className="h-2.5 w-2.5 rounded-full bg-emerald-500"
                    aria-hidden
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    return (
      <div className="rounded-[18px] bg-[color:var(--bg-elevated)] p-4 text-sm text-[color:var(--text-muted)]">
        Select a tool from the right rail to open its compact options panel.
      </div>
    );
  };

  if (roomLoadError || expired)
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md space-y-3 p-8 text-center">
          <h1 className="text-2xl font-semibold">Room unavailable</h1>
          <p className="text-slate-600">
            {roomLoadError || "This temporary room is no longer active."}
          </p>
          <Button className="mt-2" onClick={() => router.push("/")}>
            Go to home
          </Button>
        </Card>
      </main>
    );
  if (
    roomMeta?.visibility === "private" &&
    !roomReady &&
    !hasRoomAccessGrant(roomMeta.roomId)
  )
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md space-y-4 p-8">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold">Private room</h1>
            <p className="text-slate-600">
              Enter the password for{" "}
              {roomMeta.name || `room ${roomMeta.roomId}`} to start the live
              session.
            </p>
          </div>
          <input
            type="password"
            value={privateRoomPassword}
            onChange={(event) => setPrivateRoomPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isUnlockingPrivateRoom)
                void unlockPrivateRoom();
            }}
            className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2.5 text-sm outline-none ring-0 transition focus:border-[color:var(--primary)] focus:shadow-[0_0_0_3px_rgba(28,117,188,0.16)]"
            placeholder="Room password"
          />
          {privateRoomError && (
            <p className="text-sm text-red-600">{privateRoomError}</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1"
              onClick={() => void unlockPrivateRoom()}
              disabled={isUnlockingPrivateRoom}
            >
              {isUnlockingPrivateRoom ? "Unlocking..." : "Unlock room"}
            </Button>
            <SecondaryButton
              className="flex-1"
              onClick={() => router.push("/")}
            >
              Back home
            </SecondaryButton>
          </div>
        </Card>
      </main>
    );

  return (
    <main
      className={`room-workspace-shell relative flex flex-col h-[var(--room-viewport-height,100dvh)] overflow-hidden p-1.5 sm:p-2 min-[960px]:p-4 ${isLandscapeWorkspaceOnly ? "room-landscape-enforced" : ""}`}
      data-landscape-only={isLandscapeWorkspaceOnly ? "true" : "false"}
      data-rotated={shouldRotateWorkspace ? "true" : "false"}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#ffffff_0%,rgba(255,255,255,0.78)_18%,rgba(248,244,232,0)_58%)]" />
      <div
        className={`relative mx-auto flex h-full min-h-0 w-full max-w-[1920px] gap-1.5 overflow-hidden rounded-[24px] sm:rounded-[28px] border border-white/60 bg-[linear-gradient(150deg,rgba(12,26,43,0.05),rgba(255,255,255,0.72))] p-1 sm:p-1.5 shadow-[0_24px_64px_rgba(26,26,26,0.12)] min-[960px]:gap-2 min-[960px]:p-2`}
      >
        <aside
          className={`relative z-30 shrink-0 ${isTouchWorkspace ? "w-[56px]" : "w-[68px] xl:w-[72px]"}`}
        >
          <div
            className={`${sidebarShell} flex h-full w-full flex-col items-center gap-1.5 py-1.5 ${desktopRailColumn}`}
          >
            <div className={desktopRailGroup}>
              <button
                type="button"
                className={railButtonBase}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => undoStroke()}
                disabled={!hasJoined || !canUndo}
                aria-label="Undo"
              >
                <Undo2 size={18} />
              </button>
              <button
                type="button"
                className={railButtonBase}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => redoStroke()}
                disabled={!hasJoined || !canRedo}
                aria-label="Redo"
              >
                <Redo2 size={18} />
              </button>
              <button
                type="button"
                className={railButtonBase}
                onPointerDown={(event) => event.preventDefault()}
                onClick={download}
                disabled={!hasJoined}
                aria-label="Export board"
              >
                <Download size={18} />
              </button>
              <button
                type="button"
                className={railButtonBase}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => setIsClearModalOpen(true)}
                disabled={!hasJoined}
                aria-label="Clear board"
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className={`${desktopRailGroup} mt-auto`}>
              <button
                type="button"
                className={railButtonBase}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  pushToast("Room link copied.");
                }}
                aria-label="Copy room link"
              >
                <Link2 size={18} />
              </button>
              <button
                type="button"
                className={`${railButtonBase} relative ${activeFunctionPanel === "chat" ? "bg-[color:var(--brand-blue)] text-white" : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveToolPanel(null);
                  setActiveFunctionPanel((value) =>
                    value === "chat" ? null : "chat",
                  );
                }}
                aria-label="Open chat"
              >
                <MessageSquare size={18} />
                {!!chatMessages.length && (
                  <span className={railBadge}>
                    {Math.min(chatMessages.length, 9)}
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`${railButtonBase} text-[color:var(--brand-red)]`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => setIsExitModalOpen(true)}
                aria-label="Leave room"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </aside>

        <section className="relative flex min-h-0 flex-1 overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(199,232,255,0.95),rgba(231,244,253,0.94))] ring-1 ring-black/5 min-[960px]:px-3 min-[960px]:py-2">
          {connectionMessage && (
            <div
              className={`pointer-events-none absolute left-3 top-3 z-30 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-sm ${error || status === "reconnecting" || status === "disconnected" ? "bg-[color:var(--danger-soft)] text-[#8f2323]" : "bg-white/92 text-[color:var(--text-muted)]"}`}
            >
              {connectionMessage}
            </div>
          )}

          {(isRoomLoading || isBoardInitializing) && !roomLoadError ? (
            <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-full bg-white/92 px-3 py-1.5 text-[11px] font-semibold text-[color:var(--text-muted)] shadow-sm">
              {isRoomLoading
                ? "Opening room…"
                : hasJoined
                  ? "Finalizing board…"
                  : "Connecting board…"}
            </div>
          ) : null}

          <div className="h-full w-full opacity-100 transition-opacity duration-200">
            <CanvasBoard
              roomId={roomId}
              userId={userId}
              displayName={displayName}
              avatarUrl={avatarUrl}
              tool={tool}
              brushStyle={brushStyle}
              color={strokeColor}
              fillColor={fillColor}
              fillEnabled={fillEnabled}
              size={size}
              strokes={strokes}
              cursors={cursors}
              setStrokes={setStrokes}
              disabled={!hasJoined}
              resetViewSignal={resetViewSignal}
              compact={isTouchWorkspace}
              layoutReadySignal={boardLayoutReadySignal}
              onSurfaceInteract={() => closeFloatingPanels()}
              onBoardReadyChange={setIsBoardSurfaceReady}
            />
          </div>
          {reactionBursts.map((burst) => (
            <span
              key={burst.id}
              className="pointer-events-none absolute bottom-12 z-30 animate-[float-up_2.2s_ease-in_forwards] text-4xl drop-shadow-lg"
              style={{ left: `${burst.left}%` }}
            >
              {burst.emoji}
            </span>
          ))}
        </section>

        <aside
          className={`relative z-30 shrink-0 ${isTouchWorkspace ? "w-[56px]" : "w-[68px] xl:w-[72px]"}`}
        >
          <div
            className={`${sidebarShell} flex h-full w-full flex-col items-center gap-1.5 py-1.5 ${desktopRailColumn}`}
          >
            <div className={desktopRailGroup}>
              {[
                {
                  id: "brush",
                  icon: Brush,
                  active: tool === "pen",
                  onClick: () => {
                    setTool("pen");
                    openToolPanel("brush");
                  },
                  label: "Brush",
                },
                {
                  id: "eraser",
                  icon: Eraser,
                  active: tool === "eraser",
                  onClick: () => {
                    setTool("eraser");
                    openToolPanel("eraser");
                  },
                  label: "Eraser",
                },
                {
                  id: "fill",
                  icon: PaintBucket,
                  active: tool === "fill",
                  onClick: () => {
                    setTool("fill");
                    openToolPanel("fill");
                  },
                  label: "Fill",
                },
                {
                  id: "shapes",
                  icon: Shapes,
                  active: isShapeTool,
                  onClick: () => openToolPanel("shapes"),
                  label: "Shapes",
                },
                {
                  id: "reactions",
                  icon: Smile,
                  active: activeToolPanel === "reactions",
                  onClick: () => openToolPanel("reactions"),
                  label: "Reactions",
                },
                {
                  id: "info",
                  icon: Info,
                  active: activeToolPanel === "info",
                  onClick: () => openToolPanel("info"),
                  label: "Room info",
                },
              ].map(({ id, icon: Icon, active, onClick, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`${railButtonBase} ${active ? "bg-[color:var(--brand-blue)] text-white" : ""}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClick();
                  }}
                  aria-label={label}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </div>
        </aside>

        {activeFunctionPanel === "chat" && (
          <div
            ref={functionPanelRef}
            className={`room-floating-chat-panel absolute left-[calc(0.25rem+56px)] right-3 z-40 flex min-h-0 w-auto max-w-[420px] flex-col overflow-hidden sm:left-[calc(0.5rem+72px)] sm:right-auto sm:w-[min(420px,calc(100vw-7rem))] ${floatingPanelCard}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-black text-[color:var(--text-main)]">
                Chat
              </p>
              <button
                type="button"
                className="rounded-full p-1 text-[color:var(--text-muted)] hover:bg-[color:var(--surface-soft)]"
                onClick={() => setActiveFunctionPanel(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className={`${floatingPanelBody} space-y-2 pb-1`}>
              {chatMessages.length === 0 ? (
                <div className="rounded-[18px] bg-[color:var(--bg-elevated)] px-3 py-4 text-sm text-[color:var(--text-muted)]">
                  No messages yet. Start the conversation.
                </div>
              ) : (
                chatMessages.map((message) => (
                  <div
                    key={message.messageId}
                    className="rounded-[18px] bg-[color:var(--bg-elevated)] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[color:var(--text-main)]">
                        {message.displayName}
                      </span>
                      <span className="text-[11px] text-[color:var(--text-muted)]">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[color:var(--text-main)]">
                      {message.text}
                    </p>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="room-chat-composer mt-3 flex shrink-0 gap-2 border-t border-black/5 pt-3">
              <input
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendChat();
                }}
                placeholder="Send a message"
                className="min-w-0 flex-1 rounded-[16px] border border-black/5 bg-[color:var(--bg-elevated)] px-3 py-2 text-sm outline-none focus:border-[color:var(--brand-blue)]"
                maxLength={240}
              />
              <Button className="px-4 py-2 text-sm" onClick={sendChat}>
                Send
              </Button>
            </div>
          </div>
        )}

        {activeToolPanel && (
          <div
            ref={toolPanelRef}
            className={`room-floating-tool-panel absolute left-auto right-[calc(0.25rem+56px)] z-40 flex min-h-0 w-[min(320px,calc(100vw-4.5rem))] max-w-[calc(100vw-4.5rem)] flex-col overflow-hidden sm:right-[calc(0.5rem+72px)] sm:w-[min(320px,calc(100vw-7rem))] ${floatingPanelCard}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-black capitalize text-[color:var(--text-main)]">
                {activeToolPanel === "info" ? "Room info" : activeToolPanel}
              </p>
              <button
                type="button"
                className="rounded-full p-1 text-[color:var(--text-muted)] hover:bg-[color:var(--surface-soft)]"
                onClick={() => setActiveToolPanel(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className={floatingPanelBody}>{renderToolPanelContent()}</div>
          </div>
        )}
      </div>

      <ConfirmModal
        title="Clear the board?"
        description="This removes all strokes for everyone in the room."
        open={isClearModalOpen}
        onCancel={() => setIsClearModalOpen(false)}
        onConfirm={clearBoard}
        confirmLabel="Clear board"
      />
      <ConfirmModal
        title="Leave room?"
        description="Your room session will close and you’ll return to the previous screen."
        open={isExitModalOpen}
        onCancel={() => setIsExitModalOpen(false)}
        onConfirm={() => void leaveRoomSafely()}
        confirmLabel="Leave room"
      />
      <ToastStack toasts={toasts} />
      <ColorWheelPicker
        isOpen={activeColorPicker !== null}
        title={
          activeColorPicker === "fill"
            ? "Shape & fill color"
            : "Brush & stroke color"
        }
        initialColor={activeColorPicker === "fill" ? fillColor : strokeColor}
        recentColors={recentColors}
        presetColors={PRESET_COLORS}
        onClose={closeColorPicker}
        onApply={applyCustomColor}
      />
    </main>
  );
}
