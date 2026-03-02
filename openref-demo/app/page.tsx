"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  FormEvent,
  ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ArrowRight,
  Globe,
  ExternalLink,
  Square,
  XCircle,
  BookOpen,
  Zap,
  MessageSquare,
  Code,
  Sun,
  Moon,
  Info,
  Github,
  X,
  Bug,
  AlertTriangle,
  Cpu,
} from "lucide-react";

/* ─── Types ─── */
interface Source {
  url: string;
  title: string;
  domain: string;
}
interface CitationMap {
  [N: number]: { url: string; title: string; domain: string };
}
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  citationMap?: CitationMap;
  isError?: boolean;
}

/* ─── Helpers ─── */
let _id = 0;
function uid() {
  return `m-${++_id}-${Date.now()}`;
}

const SUGGESTIONS = [
  { label: "What is the current stock price of NVIDIA?", icon: Zap },
  { label: "Who is the CEO of OpenAI?", icon: MessageSquare },
  { label: "What is the population of Japan?", icon: BookOpen },
  { label: "Compare React vs Vue for frontend development", icon: Code },
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Page
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSources, setStreamingSources] = useState<Source[]>([]);
  const [streamingCitations, setStreamingCitations] = useState<CitationMap>({});
  const [phase, setPhase] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showInfo, setShowInfo] = useState(true);
  const [openrefModel, setOpenrefModel] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("openref-theme") as "dark" | "light" | null;
    if (saved) setTheme(saved);
  }, []);

  useEffect(() => {
    setOpenrefModel(process.env.NEXT_PUBLIC_OPENREF_MODEL ?? "");
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("openref-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => scrollToBottom(), [messages, streamingText, scrollToBottom]);
  useEffect(() => { if (!isLoading) inputRef.current?.focus(); }, [isLoading]);

  /* ── Send ── */
  const sendQuery = useCallback(
    async (query: string) => {
      if (!query.trim() || isLoading) return;
      setInput("");
      setMessages((p) => [...p, { id: uid(), role: "user", content: query.trim() }]);
      setIsLoading(true);
      setStreamingText("");
      setStreamingSources([]);
      setStreamingCitations({});
      setPhase("searching");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim() }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Request failed");
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let sources: Source[] = [];
        let citations: CitationMap = {};

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.replace(/^data: /, "").trim();
            if (!trimmed || trimmed === "[DONE]") continue;
            try {
              const event = JSON.parse(trimmed);
              if (event.type === "sources") {
                sources = event.data.sources;
                setStreamingSources(sources);
                setPhase("generating");
              } else if (event.type === "text") {
                fullText += event.data;
                setStreamingText(fullText);
                setPhase("");
              } else if (event.type === "citations") {
                citations = event.data;
                setStreamingCitations(event.data);
              } else if (event.type === "error") {
                throw new Error(event.data);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }

        setMessages((p) => [
          ...p,
          { id: uid(), role: "assistant", content: fullText, sources, citationMap: citations },
        ]);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setMessages((p) => [
          ...p,
          { id: uid(), role: "assistant", content: (err as Error).message || "Something went wrong", isError: true },
        ]);
      } finally {
        abortRef.current = null;
        setIsLoading(false);
        setStreamingText("");
        setStreamingSources([]);
        setStreamingCitations({});
        setPhase("");
      }
    },
    [isLoading]
  );

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); sendQuery(input); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuery(input); }
  };

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg)]">
      {/* ── Navbar ── */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 h-14">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={theme === "dark" ? "/openref-dark-logo.png" : "/openref-light-logo.png"}
            alt="OpenRef"
            width={28}
            height={28}
            className="rounded-lg"
          />
          <span className="font-[family-name:var(--font-display)] text-[15px] font-bold tracking-tight text-[var(--fg)]">
            OpenRef
          </span>
        </div>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--warm-400)] transition-colors cursor-pointer"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {isEmpty ? (
            /* ─── Empty State ─── */
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col items-center justify-center h-full px-6"
            >
              {/* Logo */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="mb-7"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={theme === "dark" ? "/openref-dark-logo.png" : "/openref-light-logo.png"}
                  alt="OpenRef"
                  width={56}
                  height={56}
                  className="rounded-2xl"
                />
              </motion.div>

              {/* Heading */}
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 }}
                className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold tracking-tight text-[var(--fg)] mb-2 text-center"
              >
                What do you want to know?
              </motion.h1>

              {/* Subtitle */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-[var(--fg-muted)] text-sm mb-10 text-center max-w-sm"
              >
                Get AI answers backed by real web sources with inline citations.
              </motion.p>

              {/* Suggestions */}
              <motion.div
                initial="initial"
                animate="animate"
                variants={{ animate: { transition: { staggerChildren: 0.06 } } }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg"
              >
                {SUGGESTIONS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <motion.button
                      key={s.label}
                      variants={{
                        initial: { opacity: 0, y: 12 },
                        animate: { opacity: 1, y: 0 },
                      }}
                      transition={{ duration: 0.35, ease: "easeOut" as const }}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => sendQuery(s.label)}
                      className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] text-left text-[13px] text-[var(--fg-muted)] hover:border-[var(--warm-400)] hover:text-[var(--fg)] transition-all duration-300 cursor-pointer group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[var(--special)]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--special)]/15 transition-colors">
                        <Icon size={14} className="text-[var(--special)]" />
                      </div>
                      <span className="flex-1">{s.label}</span>
                      <ArrowRight size={14} className="text-[var(--fg-hint)] opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                    </motion.button>
                  );
                })}
              </motion.div>
            </motion.div>
          ) : (
            /* ─── Messages ─── */
            <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8 space-y-1">
              {messages.map((msg, i) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.03, ease: "easeOut" as const }}
                >
                  {msg.role === "user" ? (
                    <UserMessage content={msg.content} />
                  ) : (
                    <AssistantMessage message={msg} />
                  )}
                </motion.div>
              ))}

              {/* Streaming */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {phase && <PhaseIndicator phase={phase} />}

                  {streamingSources.length > 0 && (
                    <div className="mb-4">
                      <SourcesPanel sources={streamingSources} />
                    </div>
                  )}

                  {streamingText ? (
                    <div className="prose-response">
                      <RenderContent text={streamingText} citationMap={streamingCitations} />
                      <span
                        className="inline-block w-[2px] h-[16px] bg-[var(--special)] rounded-full ml-0.5 align-middle"
                        style={{ animation: "blink 1s step-end infinite" }}
                      />
                    </div>
                  ) : !phase ? (
                    <Skeleton />
                  ) : null}
                </motion.div>
              )}

              <div ref={bottomRef} className="h-6" />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Input ── */}
      <div className="flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 sm:px-8 py-3.5">
          <form onSubmit={handleSubmit}>
            <div className="flex items-end gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-2 transition-colors duration-200 focus-within:border-[var(--warm-400)]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                rows={1}
                disabled={isLoading}
                className="flex-1 resize-none bg-transparent px-3 py-2 text-[0.9375rem] text-[var(--fg)] outline-none placeholder:text-[var(--fg-hint)] disabled:opacity-40 leading-relaxed"
                style={{ minHeight: "38px", maxHeight: "130px" }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 130) + "px";
                }}
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="flex-shrink-0 h-9 px-4 rounded-full bg-[var(--fg-muted)] text-[var(--bg)] flex items-center justify-center gap-1.5 text-xs font-semibold hover:bg-[var(--fg)] transition-colors cursor-pointer"
                >
                  <Square size={12} />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex-shrink-0 h-9 px-5 rounded-full bg-[var(--btn-bg)] text-[var(--btn-fg)] flex items-center justify-center gap-1.5 text-xs font-semibold disabled:opacity-20 hover:opacity-90 transition-opacity cursor-pointer"
                >
                  Search
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </form>
          <div className="flex items-center justify-center gap-2 mt-2.5 relative">
            <p className="text-[10px] text-[var(--fg-hint)] tracking-wide">
              Built with <a href="https://github.com/altamsh04/openref" target="_blank" className="text-[var(--special)] hover:underline">OpenRef SDK</a> &middot; May generate incorrect information.
            </p>
            <button
              onClick={() => setShowInfo((v) => !v)}
              className="w-5 h-5 rounded-full border border-[var(--border)] flex items-center justify-center text-[var(--fg-hint)] hover:text-[var(--fg-muted)] hover:border-[var(--warm-400)] transition-colors cursor-pointer"
              aria-label="About this demo"
            >
              <Info size={11} />
            </button>

            {/* Info popup */}
            <AnimatePresence>
              {showInfo && (
                <>
                  {/* Backdrop */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 bg-black/40 z-40"
                    onClick={() => setShowInfo(false)}
                  />
                  {/* Modal */}
                  <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ duration: 0.25, ease: "easeOut" as const }}
                    className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] max-w-[calc(100vw-2rem)] bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-2xl z-50"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={theme === "dark" ? "/openref-dark-logo.png" : "/openref-light-logo.png"}
                          alt="OpenRef"
                          width={32}
                          height={32}
                          className="rounded-xl"
                        />
                        <div>
                          <h3 className="text-[14px] font-bold text-[var(--fg)]">OpenRef Demo</h3>
                          <p className="text-[10px] text-[var(--fg-hint)]">SDK Showcase</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShowInfo(false)}
                        className="w-7 h-7 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--fg-hint)] hover:text-[var(--fg)] hover:border-[var(--warm-400)] transition-colors cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Notice items */}
                    <div className="space-y-2.5 mb-4">
                      <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[var(--bg)]">
                        <AlertTriangle size={14} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
                        <p className="text-[11.5px] text-[var(--fg-muted)] leading-relaxed">
                          This is <strong className="text-[var(--fg)]">not a finished product</strong> — just a demo for the <strong className="text-[var(--fg)]">OpenRef SDK</strong>. Not production ready.
                        </p>
                      </div>

                      <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[var(--bg)]">
                        <Globe size={14} className="text-[var(--special)] flex-shrink-0 mt-0.5" />
                        <p className="text-[11.5px] text-[var(--fg-muted)] leading-relaxed">
                          Web search is <strong className="text-[var(--fg)]">still in progress</strong>. Responses may be slow or incomplete.
                        </p>
                      </div>

                      <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[var(--bg)]">
                        <Cpu size={14} className="text-[var(--fg-muted)] flex-shrink-0 mt-0.5" />
                        <p className="text-[11.5px] text-[var(--fg-muted)] leading-relaxed">
                          Running on free OpenRouter model:{" "}
                          <strong className="text-[var(--fg)]">{openrefModel || "default"}</strong>
                        </p>
                      </div>
                    </div>

                    {/* About OpenRef */}
                    <div className="p-3 rounded-lg border border-[var(--border)] mb-4">
                      <p className="text-[11px] font-semibold text-[var(--fg-muted)] uppercase tracking-widest mb-1.5">About OpenRef</p>
                      <p className="text-[11.5px] text-[var(--fg-muted)] leading-relaxed">
                        OpenRef is an open-source TypeScript SDK that turns natural language queries into web-grounded answers with inline citations from real sources.
                      </p>
                    </div>

                    {/* Action links */}
                    <div className="flex gap-2">
                      <a
                        href="https://github.com/altamsh04/openref"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--btn-bg)] text-[var(--btn-fg)] text-[12px] font-semibold hover:opacity-90 transition-opacity"
                      >
                        <Github size={14} />
                        GitHub
                      </a>
                      <a
                        href="https://github.com/altamsh04/openref/issues"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-[var(--border)] text-[12px] font-semibold text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--warm-400)] transition-colors"
                      >
                        <Bug size={14} />
                        Report Bug
                      </a>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ━━━ User Message ━━━ */
function UserMessage({ content }: { content: string }) {
  return (
    <div className="py-5">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[var(--btn-bg)] text-[var(--btn-fg)] flex items-center justify-center text-[10px] font-bold mt-0.5">
          U
        </div>
        <p className="font-[family-name:var(--font-display)] text-[17px] font-bold text-[var(--fg)] leading-relaxed pt-[2px]">
          {content}
        </p>
      </div>
    </div>
  );
}

/* ━━━ Assistant Message ━━━ */
function AssistantMessage({ message }: { message: Message }) {
  if (message.isError) {
    return (
      <div className="mb-6 bg-[var(--card)] border border-[var(--error)]/25 rounded-2xl p-5">
        <div className="flex items-center gap-2.5 text-[var(--error)] text-sm font-medium">
          <XCircle size={16} />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      {/* Sources */}
      {message.sources && message.sources.length > 0 && (
        <div className="mb-5">
          <SourcesPanel sources={message.sources} />
        </div>
      )}

      {/* Response text — directly on background, no card */}
      <div className="prose-response">
        <RenderContent text={message.content} citationMap={message.citationMap || {}} />
      </div>

      {/* Citation pills */}
      {message.citationMap && Object.keys(message.citationMap).length > 0 && (
        <CitationFooter citationMap={message.citationMap} />
      )}
    </div>
  );
}

/* ━━━ Sources Panel ━━━ */
function SourcesPanel({ sources }: { sources: Source[] }) {
  return (
    <div>
      {/* Label */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-md bg-[var(--special)]/10 flex items-center justify-center">
          <Globe size={11} className="text-[var(--special)]" />
        </div>
        <span className="text-[11px] font-semibold text-[var(--fg-muted)] uppercase tracking-widest">
          Sources
        </span>
        <span className="text-[9px] text-[var(--fg-hint)] bg-[var(--border)] px-1.5 py-[2px] rounded-full font-bold ml-0.5">
          {sources.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {sources.map((source, i) => (
          <motion.a
            key={i}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3, ease: "easeOut" as const }}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex-shrink-0 w-[210px] flex items-start gap-3 px-3.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:border-[var(--warm-400)] transition-all duration-300"
          >
            {/* Favicon */}
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[var(--bg)] flex items-center justify-center overflow-hidden mt-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://www.google.com/s2/favicons?domain=${source.domain}&sz=32`}
                alt=""
                width={16}
                height={16}
                className="rounded-sm"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            {/* Text */}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[var(--fg)] truncate leading-snug group-hover:text-[var(--special)] transition-colors">
                {source.title || source.domain}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-4 h-4 rounded-full bg-[var(--special)]/15 text-[var(--special)] flex items-center justify-center text-[8px] font-bold flex-shrink-0">
                  {i + 1}
                </span>
                <span className="text-[10px] text-[var(--fg-hint)] truncate">{source.domain}</span>
              </div>
            </div>
            {/* Arrow */}
            <ExternalLink size={12} className="text-[var(--fg-hint)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
          </motion.a>
        ))}
      </div>
    </div>
  );
}

/* ━━━ Citation Footer ━━━ */
function CitationFooter({ citationMap }: { citationMap: CitationMap }) {
  const entries = Object.entries(citationMap).map(([k, v]) => ({ n: Number(k), ...v }));
  if (!entries.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {entries.map((c) => (
        <a
          key={c.n}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          title={c.title}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[10px] text-[var(--fg-muted)] font-medium hover:border-[var(--warm-400)] hover:text-[var(--fg)] transition-all duration-300"
        >
          <span className="w-4 h-4 rounded-full bg-[var(--special)]/15 text-[var(--special)] flex items-center justify-center text-[8px] font-bold">
            {c.n}
          </span>
          <span className="max-w-[110px] truncate">{c.domain}</span>
        </a>
      ))}
    </div>
  );
}

/* ━━━ Phase Indicator ━━━ */
function PhaseIndicator({ phase }: { phase: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-3 mb-5 py-2"
    >
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[var(--special)]"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" as const }}
          />
        ))}
      </div>
      <span className="text-[13px] text-[var(--fg-muted)] font-medium">
        {phase === "searching" ? "Searching the web" : "Generating answer"}...
      </span>
    </motion.div>
  );
}

/* ━━━ Skeleton ━━━ */
function Skeleton() {
  return (
    <div className="py-1">
      <div className="space-y-3">
        {[100, 88, 95, 55].map((w, i) => (
          <div
            key={i}
            className="h-2.5 rounded-full"
            style={{
              width: `${w}%`,
              background: `linear-gradient(90deg, var(--border) 25%, var(--warm-200) 50%, var(--border) 75%)`,
              backgroundSize: "200% 100%",
              animation: `shimmer 1.5s infinite`,
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ━━━ Render Content ━━━ */
function RenderContent({ text, citationMap }: { text: string; citationMap: CitationMap }) {
  return (
    <div>
      {text.split("\n").map((line, li) => {
        if (!line.trim()) return <br key={li} />;

        const heading = line.match(/^(#{1,3})\s+(.+)/);
        if (heading) {
          const Tag = (`h${heading[1].length}`) as "h1" | "h2" | "h3";
          return <Tag key={li}>{renderInline(heading[2], citationMap)}</Tag>;
        }

        const bullet = line.match(/^[\s]*[-*]\s+(.+)/);
        if (bullet) {
          return (
            <div key={li} className="flex gap-2.5 mb-1.5 ml-0.5">
              <span className="text-[var(--special)] mt-[6px] flex-shrink-0 w-1 h-1 rounded-full bg-[var(--special)]" />
              <span className="leading-relaxed">{renderInline(bullet[1], citationMap)}</span>
            </div>
          );
        }

        const numbered = line.match(/^[\s]*(\d+)\.\s+(.+)/);
        if (numbered) {
          return (
            <div key={li} className="flex gap-2.5 mb-1.5 ml-0.5">
              <span className="text-[var(--fg-hint)] mt-[1px] flex-shrink-0 text-[13px] min-w-[1rem] text-right font-medium tabular-nums">
                {numbered[1]}.
              </span>
              <span className="leading-relaxed">{renderInline(numbered[2], citationMap)}</span>
            </div>
          );
        }

        const bq = line.match(/^>\s+(.+)/);
        if (bq) return <blockquote key={li}>{renderInline(bq[1], citationMap)}</blockquote>;

        return <p key={li}>{renderInline(line, citationMap)}</p>;
      })}
    </div>
  );
}

/* ━━━ Inline Render ━━━ */
function renderInline(text: string, citationMap: CitationMap): ReactNode[] {
  return text.split(/(\[\d+\]|\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    const cit = part.match(/^\[(\d+)\]$/);
    if (cit) {
      const n = parseInt(cit[1]);
      const c = citationMap[n];
      if (c) {
        return (
          <a
            key={i}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${c.title} — ${c.domain}`}
            className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[var(--special)]/15 text-[var(--special)] text-[9px] font-bold hover:bg-[var(--special)] hover:text-[var(--bg)] transition-colors duration-200 align-middle mx-[2px] no-underline cursor-pointer"
          >
            {n}
          </a>
        );
      }
      return <span key={i} className="text-[var(--fg-hint)] text-[10px] align-super font-medium">[{n}]</span>;
    }

    const bold = part.match(/^\*\*(.+)\*\*$/);
    if (bold) return <strong key={i}>{bold[1]}</strong>;

    const code = part.match(/^`(.+)`$/);
    if (code) return <code key={i}>{code[1]}</code>;

    return <span key={i}>{part}</span>;
  });
}
