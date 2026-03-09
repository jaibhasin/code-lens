"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { MonacoBinding } from "y-monaco";
import type { Language } from "@/lib/store";

export interface MonacoWithYjsHandle {
  getCode: () => string;
  /**
   * Replaces the current editor content with the given code.
   * This updates the shared Yjs document so all collaborators see the change.
   */
  setCode: (code: string) => void;
}

/**
 * Represents a remote peer currently connected to the same Yjs room.
 * Populated from y-websocket awareness — each connected client broadcasts
 * its own user field; we aggregate all non-self states into this shape.
 *
 * clientId  — unique integer assigned by Yjs per connection (not persistent)
 * name      — display label shown on the remote cursor in Monaco
 * color     — hex color for the cursor / presence dot
 * role      — "interviewer" or "candidate"; used by the page to filter peers
 */
export interface AwarenessPeer {
  clientId: number;
  name: string;
  color: string;
  role: "interviewer" | "candidate";
}

/**
 * Canonical brand colors for each role.
 *
 * candidate   → emerald-500  (matches the Run button)
 * interviewer → blue-500     (matches the Submit button)
 *
 * These are also the colors that y-monaco uses to paint the remote cursor
 * and selection highlight in the editor.
 */
const ROLE_COLORS: Record<"interviewer" | "candidate", string> = {
  candidate: "#10b981",
  interviewer: "#3b82f6",
};

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234";

/**
 * Maps our internal language key to Monaco's language identifier.
 * Monaco uses these strings for syntax highlighting.
 */
/**
 * Maps our internal language key to Monaco's language identifier.
 * Monaco uses these strings for syntax highlighting.
 * Note: TypeScript → "typescript", Go → "go" are built into Monaco.
 */
const LANG_MAP: Record<Language, string> = {
  c: "c",
  cpp: "cpp",
  java: "java",
  javascript: "javascript",
  python: "python",
  typescript: "typescript",
  go: "go",
};

/**
 * Starter code templates loaded into the editor when the language is first
 * selected (or switched) and the editor is currently empty.
 *
 * Each template includes:
 *  - Required boilerplate (includes / imports)
 *  - A minimal main entry point
 *  - A placeholder `solution` function with a TODO comment
 *
 * Why preload?  Candidates can start typing immediately instead of having to
 * write the scaffold from memory under interview pressure.
 */
const TEMPLATES: Record<Language, string> = {
  // ── C ──────────────────────────────────────────────────────────────────────
  c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* TODO: implement your solution here */
void solution() {

}

int main() {
    solution();
    return 0;
}
`,

  // ── C++ ────────────────────────────────────────────────────────────────────
  cpp: `#include <bits/stdc++.h>
using namespace std;

/* TODO: implement your solution here */
void solution() {

}

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    solution();
    return 0;
}
`,

  // ── Python ─────────────────────────────────────────────────────────────────
  python: `import sys
from typing import List, Optional

# TODO: implement your solution here
def solution():
    pass

if __name__ == "__main__":
    solution()
`,

  // ── Java ───────────────────────────────────────────────────────────────────
  // Judge0 runs Java with a public class named "Main" — the filename must match.
  java: `import java.util.*;
import java.io.*;

public class Main {

    /* TODO: implement your solution here */
    static void solution() {

    }

    public static void main(String[] args) {
        solution();
    }
}
`,

  // ── JavaScript ─────────────────────────────────────────────────────────────
  javascript: `const readline = require("readline");

// TODO: implement your solution here
function solution() {

}

solution();
`,

  // ── TypeScript ─────────────────────────────────────────────────────────────
  // Judge0 compiles TS via ts-node; no tsconfig needed for basic usage.
  typescript: `import * as readline from "readline";

// TODO: implement your solution here
function solution(): void {

}

solution();
`,

  // ── Go ─────────────────────────────────────────────────────────────────────
  // Go requires `package main` and an explicit `main()` entry point.
  go: `package main

import (
\t"bufio"
\t"fmt"
\t"os"
)

// TODO: implement your solution here
func solution() {

}

func main() {
\t_ = bufio.NewReader(os.Stdin)
\t_ = fmt.Println
\tsolution()
}
`,
};

type MonacoEditor = Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0];

interface MonacoWithYjsProps {
  roomId: string;
  language: Language;
  height?: string | number;
  /**
   * The viewer's role in this session.
   *
   * - "candidate"   → editor is editable; awareness color = emerald
   * - "interviewer" → editor is READ-ONLY (keyboard input blocked, but remote
   *                   edits from MonacoBinding still apply in real-time)
   *                   awareness color = blue
   */
  role: "interviewer" | "candidate";
  /**
   * Extra read-only flag independent of role.
   * Used to lock the candidate's editor while the session hasn't started yet.
   * When true the editor rejects keyboard input but still shows remote edits.
   */
  extraReadOnly?: boolean;
  /**
   * Called whenever the set of connected remote peers changes.
   * The array contains every non-self peer that has broadcast a `user` field
   * via Yjs awareness. The page uses this to render the presence indicator.
   */
  onPresenceChange?: (peers: AwarenessPeer[]) => void;
}

export const MonacoWithYjs = forwardRef<MonacoWithYjsHandle, MonacoWithYjsProps>(
  function MonacoWithYjs({ roomId, language, height = "100%", role, extraReadOnly = false, onPresenceChange }, ref) {
  const [ready, setReady] = useState(false);
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  /**
   * Boot the Yjs document and connect to the shared WebSocket room.
   * This runs once per roomId. On unmount we cleanly disconnect so no
   * stale providers linger in the background.
   *
   * After the provider is created we immediately publish our identity via
   * `setLocalStateField("user", ...)`.  We use `setLocalStateField` (not
   * `setLocalState`) so we only overwrite the "user" sub-key — y-monaco
   * also writes cursor/selection data into awareness and `setLocalState`
   * would wipe those fields.
   *
   * `role` is intentionally excluded from the dependency array: it is
   * derived from the URL at mount time and never changes during a session.
   */
  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, roomId, doc);
    docRef.current = doc;
    providerRef.current = provider;

    // Broadcast our identity to all peers in the room.
    provider.awareness.setLocalStateField("user", {
      name: role === "interviewer" ? "Interviewer" : "Candidate",
      color: ROLE_COLORS[role],
      role,
    });

    setReady(true);
    return () => {
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      providerRef.current = null;
      setReady(false);
    };
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Expose two methods to parent components via the forwarded ref:
   *
   *  - getCode()      → returns current editor text (used by Run / Submit)
   *  - setCode(code)  → replaces the Yjs shared text with `code` so every
   *                     connected client instantly sees the new content.
   *                     This is how we inject language templates on switch.
   */
  useImperativeHandle(ref, () => ({
    getCode: () => docRef.current?.getText("monaco").toString() ?? "",
    setCode: (code: string) => {
      const ytext = docRef.current?.getText("monaco");
      if (!ytext) return;
      // Perform a single transactional replacement so Yjs treats it as one
      // atomic operation — avoids partial-update flicker for remote clients.
      docRef.current!.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, code);
      });
    },
  }));

  /**
   * Clean up the Monaco ↔ Yjs binding when the component unmounts.
   * The binding holds Monaco model listeners; failing to destroy it causes
   * memory leaks and stale event handlers.
   */
  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, []);

  /**
   * Subscribe to Yjs awareness changes and forward peer list to the parent.
   *
   * Awareness is a lightweight pub-sub layer built into y-websocket.  Every
   * connected client broadcasts arbitrary JSON; we read the `user` sub-key
   * that we set in the roomId effect above.
   *
   * Guards:
   *  - `!ready`          → provider not yet created, skip
   *  - `clientId === self` → skip our own entry (we only care about *remote* peers)
   *  - `!state.user`     → skip relay/ghost entries from the y-websocket server
   *
   * `handler()` is called once immediately so late-joiners see existing peers
   * without waiting for the next awareness update.
   */
  useEffect(() => {
    if (!ready) return;
    const provider = providerRef.current!;

    const handler = () => {
      const peers: AwarenessPeer[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === provider.awareness.clientID) return; // skip self
        if (!state.user) return;                              // skip relay peers with no user field
        peers.push({ clientId, ...state.user });
      });
      onPresenceChange?.(peers);
    };

    handler(); // fire once immediately so late joiners get current state
    provider.awareness.on("change", handler);
    return () => provider.awareness.off("change", handler);
  }, [ready, onPresenceChange]);

  /**
   * Tracks the current language so handleMount (called by Monaco's onMount
   * which fires on every remount) always reads the latest value without
   * being stale-closed over a previous render's `language` prop.
   */
  const languageRef = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);

  /**
   * Called once Monaco finishes rendering the editor DOM.
   * Monaco remounts the editor (and re-fires onMount) whenever the `language`
   * prop changes, so this can run multiple times per session.
   *
   * Steps:
   *  1. Destroy any previous MonacoBinding to prevent duplicate listeners.
   *  2. Wire up a fresh MonacoBinding immediately so remote edits render live.
   *  3. After the WebSocket finishes its initial sync (provider `sync` event),
   *     seed the template only if the doc is still empty.
   *
   * WHY wait for sync:
   *  handleMount fires before the WS handshake completes. At that instant
   *  ytext.length is 0 even if the server already has content. If we insert
   *  the template immediately it gets appended on top of the synced content.
   *  Waiting for `sync` gives us the true post-sync length.
   */
  const handleMount = (editor: MonacoEditor) => {
    const doc = docRef.current;
    const provider = providerRef.current;
    if (!doc || !provider) return;

    // Destroy previous binding before creating a new one.
    bindingRef.current?.destroy();
    bindingRef.current = null;

    const ytext = doc.getText("monaco");
    const model = editor.getModel();
    if (!model) return;

    // Wire up the binding immediately so remote cursors / edits work right away.
    const binding = new MonacoBinding(
      ytext,
      model,
      new Set([editor]),
      provider.awareness
    );
    bindingRef.current = binding;

    // Seed the template only after the initial sync, so we know whether the
    // server-side doc is truly empty (fresh room) or already has content.
    const seedIfEmpty = () => {
      if (ytext.length === 0) {
        doc.transact(() => {
          ytext.insert(0, TEMPLATES[languageRef.current]);
        });
      }
    };

    if (provider.synced) {
      // Already synced (e.g. language-switch remount) — check immediately.
      seedIfEmpty();
    } else {
      provider.once("sync", seedIfEmpty);
    }
  };

  if (!ready || !docRef.current) {
    return (
      <div className="flex items-center justify-center h-64 bg-zinc-900 rounded border border-zinc-700 text-zinc-400">
        Connecting…
      </div>
    );
  }

  return (
    <Editor
      height={height}
      /*
       * `language` (not `defaultLanguage`) so Monaco re-applies syntax
       * highlighting whenever the parent passes a new language prop.
       * Using defaultLanguage would lock the highlighting to the first value.
       */
      language={LANG_MAP[language]}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        /*
         * Interviewers are read-only observers — they should never accidentally
         * edit the candidate's code.  `readOnly: true` blocks all keyboard
         * input in Monaco but does NOT block MonacoBinding from applying remote
         * Yjs operations, so the interviewer still sees the candidate typing
         * live.  `readOnlyMessage` surfaces a tooltip when the interviewer
         * tries to type.
         */
        readOnly: role === "interviewer" || extraReadOnly,
        readOnlyMessage: {
          value: extraReadOnly
            ? "Waiting for the interviewer to start the session…"
            : "Interviewer view — read only",
        },
      }}
      onMount={handleMount}
    />
  );
});
