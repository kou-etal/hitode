"use client";//クライアントコンポーネント

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
}//TODO:別にフロントにs3Keyとか使ってない。

interface UploadedImage {
  imageId: string;
  filename: string;
  status: "uploading" | "done" | "error";
}//これrequest用、APIの通信に使う型ではない。フロントのUI状態管理用の型。

export default function ImagesPage() {
  // upload系。これはUI表示用。
  const [uploads, setUploads] = useState<UploadedImage[]>([]);
  //uploadsはそれぞれでstatusが異なるからsearchedとは違い
  // const [searched, setSearched] = useState(false);で定義せずにuploadsに含める。
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  //TODO:isUploadingは冗長。uploadsから計算できる。 const isUploading = uploads.some(u => u.status === "uploading");
  //stateから計算できるものはuseStateにしないのが原則。

  // Search系
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleUpload = async (files: FileList | null) => {
    //FileListはブラウザのWeb API標準の型。<input type="file">が返すファイルの一覧。
    //fileのinputはFileList | nullを返す。これがブラウザの仕様。
    //ファイル押してダイアログ開いてキャンセルした場合onchangeが動いてnullになる場合ある。
    //ゆえにその場合はreturnで分岐する。
    //input textの場合は型がstringだけになるからnull許容しないでいい。
    if (!files || files.length === 0) return;
    setIsUploading(true);

    for (const file of Array.from(files)) {
      //filelistは配列に似てるけど配列ではないから.map .filter使えない。
      //ゆえにArray.from(files)で配列にしてから扱う。
      //Array.from(files).map(...)でも可能。
      //現在は一枚ずつアップロードになっているがmapにした場合promise.all使って並列にできる。
      //並列にすると効率は良くなるが大量アップロードでブラウザに負荷かかる。
      //TODO:安全をとる現在、並列にして効率にするかの設計判断。

      const tempId = crypto.randomUUID();
      setUploads((prev) => [
        { imageId: tempId, filename: file.name, status: "uploading" },
        ...prev,
      ]);//ここはupload状態を表示するUI部分。
      //1枚目がアップロードされるとuploading->doneに遷移して次2枚目は1枚目の結果を受け取ってから2枚目の状況を表示する。
      //一旦loadingUIを表示するために仮のuuidを作っている。status更新の際にimageIDで識別するからuuid必須。重複不可。

      try {
        // 1. presigned URL取得
        //try一つの中にapi叩き二つ。
        //今回は一つ目失敗したら二つ目不可能。二つ目が一つ目に依存している。
        //二つが独立してて一つ目が失敗しても二つ目の操作可能な場合二つのtryに分ける。
        const res = await fetch("/api/image-upload", {//api叩きは非同期で行う。
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
          }),//bodyのデータはこれだけ。これに対してサーバーサイドがkey作ってpresigned url返す。
          //bodyはjson必須やからJavaScriptのオブジェクト { filename: "dog.png", contentType: "image/png" }  
          //これをJSON文字列{"filename":"cat.png","contentType":"image/png"}に変換する。
        });
        const { imageId, presignedUrl } = await res.json();
        //ここで真のimageID受け取る。
        /*TODO:これ型チェックするべき。
         リクエストはzodで実行時チェック。レスポンスは asで型付けが実務標準。
         */


        // 2. S3に直接アップロード
        await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,//ファイルの場合はjsonにせずにfileで扱える。
        });

        //アップロード成功後に、該当するアップロードのstateを更新する。
        //...uで展開。idが同様のuを更新する。tempid->imageid
        // { ...u }         → { imageId: "temp-abc", filename: "cat.png", status: "uploading" }
        //{ ...u, imageId } // → { imageId: "server-xyz", filename: "cat.png", status: "uploading" }
        //doneはリテラル型であることを記述する。string型にならないように。
        //prev[0].statusで変更してしまうとReactが変更と判断せずに再レンダリングされない。
        //prev.mapでコピーすることで再レンダリングされる。
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
          ),//TODO:ログ出力。
        );
      }
    }

    setIsUploading(false);//tryの外。全ファイルupload終了。
    if (fileInputRef.current) fileInputRef.current.value = "";
    //fileInputRef.current — useRefで紐付けた<input type="file">のDOM要素
    //リセットしないと同じファイルをもう一度アップロードしたい場合にonChangeが動かない。
 
  };
  //exportの中身は定義+関数+html

  //UI表示にずっと使う変数はusestateで宣言、一時的な変数は宣言しない。
  //fileの場合はinputした後は使わない。->useStateではない。->引数になる。
  /*queryの場合UI表示に使う。->useState-?引数使わずに
  <Input                                                                                                                                         value={query}                          // ← queryを表示                                                                                  
    onChange={(e) => setQuery(e.target.value)}  // ← 入力するたびにqueryを更新                                                               
    placeholder="e.g. 赤い画像、風景写真..."
  />*/
  const handleSearch = async () => {
    if (!query.trim()) return;//TODO:!query.trim() || isSearchingで連打防止した方が良い。
    setIsSearching(true);
    setSearched(true);
    //これは検索が終わったかではなく検索が実行されたかを表す変数。

    try {
      const res = await fetch("/api/image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      /* 返り値は{
    images: [
      { imageId: "xxx", filename: "dog.png", s3Key: "...", description: "...", score: 0.95, imageUrl: "https://s3..." },
      // ...
    ],
    query: "赤い画像"  ← これフロントで使ってないから消していい。
  }*/
      setResults(data.images ?? []);//該当なしはあり得る。
    } catch {
      setResults([]);
      //TODO:エラー出力
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
