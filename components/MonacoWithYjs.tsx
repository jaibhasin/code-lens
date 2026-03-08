"use client";

import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { MonacoBinding } from "y-monaco";
import type { Language } from "@/lib/store";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234";

const LANG_MAP: Record<Language, string> = {
  c: "c",
  cpp: "cpp",
  python: "python",
  javascript: "javascript",
};

type MonacoEditor = Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0];

interface MonacoWithYjsProps {
  roomId: string;
  language: Language;
  height?: string | number;
}

export function MonacoWithYjs({ roomId, language, height = "100%" }: MonacoWithYjsProps) {
  const [ready, setReady] = useState(false);
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, roomId, doc);
    docRef.current = doc;
    providerRef.current = provider;
    setReady(true);
    return () => {
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      providerRef.current = null;
      setReady(false);
    };
  }, [roomId]);

  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, []);

  const handleMount = (editor: MonacoEditor) => {
    const doc = docRef.current;
    const provider = providerRef.current;
    if (!doc || !provider) return;

    const ytext = doc.getText("monaco");
    const model = editor.getModel();
    if (!model) return;

    const binding = new MonacoBinding(
      ytext,
      model,
      new Set([editor]),
      provider.awareness
    );
    bindingRef.current = binding;
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
      defaultLanguage={LANG_MAP[language]}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
      }}
      onMount={handleMount}
    />
  );
}
