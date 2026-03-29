"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState, useRef } from "react";

interface SearchResult {
  imageId: string;
  filename: string;
  s3Key: string;
  description: string;
  score: number;
  imageUrl: string;
}

interface UploadedImage {
  imageId: string;
  filename: string;
  status: "uploading" | "done" | "error";
}

export default function ImagesPage() {
  // Upload state
  const [uploads, setUploads] = useState<UploadedImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);

    for (const file of Array.from(files)) {
      const tempId = crypto.randomUUID();
      setUploads((prev) => [
        { imageId: tempId, filename: file.name, status: "uploading" },
        ...prev,
      ]);

      try {
        // 1. presigned URL取得
        const res = await fetch("/api/image-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
          }),
        });
        const { imageId, presignedUrl } = await res.json();

        // 2. S3に直接アップロード
        await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        setUploads((prev) =>
          prev.map((u) =>
            u.imageId === tempId
              ? { ...u, imageId, status: "done" as const }
              : u,
          ),
        );
      } catch {
        setUploads((prev) =>
          prev.map((u) =>
            u.imageId === tempId ? { ...u, status: "error" as const } : u,
          ),
        );
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setSearched(true);

    try {
      const res = await fetch("/api/image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setResults(data.images ?? []);
    } catch {
      setResults([]);
    }

    setIsSearching(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            H
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Hitode</h1>
        </div>
        <a href="/image-chat">
          <Button variant="outline" size="sm">
            Chat
          </Button>
        </a>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Upload Section */}
        <Card className="mb-8">
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">画像アップロード</h2>
            <div className="flex gap-3 items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                multiple
                onChange={(e) => handleUpload(e.target.files)}
                className="flex-1 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              {isUploading && (
                <span className="text-sm text-muted-foreground animate-pulse">
                  アップロード中...
                </span>
              )}
            </div>

            {uploads.length > 0 && (
              <div className="mt-4 space-y-2">
                {uploads.map((u) => (
                  <div
                    key={u.imageId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span
                      className={
                        u.status === "done"
                          ? "text-green-500"
                          : u.status === "error"
                            ? "text-red-500"
                            : "text-yellow-500"
                      }
                    >
                      {u.status === "done"
                        ? "OK"
                        : u.status === "error"
                          ? "NG"
                          : "..."}
                    </span>
                    <span className="text-muted-foreground">{u.filename}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Search Section */}
        <Card className="mb-8">
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">画像検索</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="flex gap-3"
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. 赤い画像、風景写真、テキストが写っている画像..."
                className="flex-1"
              />
              <Button type="submit" disabled={isSearching || !query.trim()}>
                {isSearching ? "検索中..." : "検索"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        {searched && (
          <div>
            <h2 className="text-lg font-semibold mb-4">
              検索結果{results.length > 0 && `（${results.length}件）`}
            </h2>

            {results.length === 0 ? (
              <p className="text-muted-foreground">
                画像が見つかりませんでした。
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {results.map((r) => (
                  <Card key={r.imageId} className="overflow-hidden">
                    <div className="aspect-video relative bg-muted">
                      {r.filename.toLowerCase().endsWith(".pdf") ? (
                        <iframe
                          src={r.imageUrl}
                          title={r.filename}
                          className="w-full h-full"
                        />
                      ) : (
                        <img
                          src={r.imageUrl}
                          alt={r.filename}
                          className="object-contain w-full h-full"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                      )}
                    </div>
                    <CardContent className="pt-4">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-medium text-sm">
                          {r.filename}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Score: {r.score.toFixed(3)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {r.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
