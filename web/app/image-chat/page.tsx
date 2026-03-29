"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useEffect, useRef, useState } from "react";

interface ImageRef {
  imageId: string;
  filename: string;
  imageUrl: string;
  score: number;
}

function getTextFromParts(parts: { type: string; text?: string }[]): string {
  return (parts ?? [])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("");
}

function parseImages(text: string): {
  cleanText: string;
  images: ImageRef[];
} {
  const match = text.match(/<!--IMAGES:(.*?)-->/s);
  if (!match) return { cleanText: text, images: [] };

  try {
    const images = JSON.parse(match[1]) as ImageRef[];
    const cleanText = text.replace(/<!--IMAGES:.*?-->/s, "").trim();
    return { cleanText, images };
  } catch {
    return { cleanText: text, images: [] };
  }
}

export default function ImageChatPage() {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/image-chat",
    }),
  });

  const isLoading = status === "streaming" || status === "submitted";

  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedImages, setExpandedImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const toggleImage = (id: string) => {
    setExpandedImages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = (text: string) => {
    if (!text.trim() || isLoading) return;
    sendMessage({
      role: "user",
      parts: [{ type: "text", text }],
    });
    setInput("");
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            H
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Hitode</h1>
        </div>
        <a href="/images">
          <Button variant="outline" size="sm">
            Upload
          </Button>
        </a>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground mt-20">
              <p className="text-2xl mb-2">画像に関するチャット</p>
              <p className="text-sm">画像について質問してみてください</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {[
                  "プログラミングに関する画像を教えて",
                  "風景の画像はある？",
                  "赤い画像を探して",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSend(suggestion)}
                    className="rounded-full border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => {
            const isUser = message.role === "user";
            const textContent = getTextFromParts(
              message.parts as { type: string; text?: string }[],
            );
            const { cleanText, images } = isUser
              ? { cleanText: textContent, images: [] }
              : parseImages(textContent);

            return (
              <div
                key={message.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    isUser ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm">{cleanText}</div>

                  {images.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {images.map((img) => (
                        <Card
                          key={img.imageId}
                          className="overflow-hidden cursor-pointer"
                          onClick={() => toggleImage(img.imageId)}
                        >
                          <div
                            className={`${expandedImages.has(img.imageId) ? "" : "aspect-square"} relative bg-muted`}
                          >
                            {img.filename.toLowerCase().endsWith(".pdf") ? (
                              <iframe
                                src={img.imageUrl}
                                title={img.filename}
                                className="w-full h-full"
                              />
                            ) : (
                              <img
                                src={img.imageUrl}
                                alt={img.filename}
                                className="object-contain w-full h-full"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            )}
                          </div>
                          <CardContent className="p-2">
                            <span className="text-xs text-muted-foreground">
                              {img.filename} ({img.score.toFixed(2)})
                            </span>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl px-4 py-3">
                <span className="text-sm text-muted-foreground animate-pulse">
                  検索中...
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t px-4 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(input);
          }}
          className="mx-auto max-w-2xl flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="画像について質問..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || !input.trim()}>
            送信
          </Button>
        </form>
      </div>
    </div>
  );
}
