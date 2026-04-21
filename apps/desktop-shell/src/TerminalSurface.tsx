import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef } from "react";

import { buildTerminalTranscript, type TerminalSession } from "./terminal-state";

import "@xterm/xterm/css/xterm.css";

interface TerminalSurfaceProps {
  emptyLabel: string;
  session: TerminalSession | null;
}

export function TerminalSurface({ emptyLabel, session }: TerminalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const transcript = useMemo(() => (session ? buildTerminalTranscript(session) : emptyLabel), [emptyLabel, session]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      disableStdin: true,
      fontFamily: '"Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      scrollback: 3000,
      theme: {
        background: "#071019",
        foreground: "#dce6f4",
        cursor: "#7ae3ff",
        cursorAccent: "#071019",
        black: "#071019",
        brightBlack: "#3f5666",
        brightBlue: "#7ae3ff",
        brightCyan: "#8ee9ff",
        brightGreen: "#b7f1a8",
        brightMagenta: "#d9b8ff",
        brightRed: "#ff9d9d",
        brightWhite: "#f4f7ff",
        brightYellow: "#ffe89b",
        blue: "#5cbcf6",
        cyan: "#60d9f6",
        green: "#8ed98b",
        magenta: "#c09cff",
        red: "#f07f7f",
        selectionBackground: "#173b52",
        white: "#dce6f4",
        yellow: "#f1c36d"
      }
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fitAddon.fit();
          });

    resizeObserver?.observe(containerRef.current);

    requestAnimationFrame(() => {
      fitAddon.fit();
      terminal.reset();
      terminal.write(transcript);
    });

    return () => {
      resizeObserver?.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.reset();
    terminal.write(transcript);
    requestAnimationFrame(() => fitAddonRef.current?.fit());
  }, [transcript]);

  return <div className="terminal-surface" ref={containerRef} />;
}
