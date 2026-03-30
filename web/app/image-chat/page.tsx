"use client";
// Client Componentの宣言

import { useChat } from "@ai-sdk/react";//これはai sdk。
import { DefaultChatTransport } from "ai";
//サーバーサイドとの通信方法の設定。HTTPで通信する。
// WebSocketにしたい場合はnew WebSocketTransport({ url: "ws://..." })にする
//HTTP — 毎回「リクエスト→レスポンス」で接続が切れる
//WebSocket — 一回つないだらつなぎっぱなし。リアルタイム通信。
import { Button } from "@/components/ui/button";
//tsconfig.jsonのpaths：部分でエイリアスを設定している。
// npx shadcn-ui add inputでcomponent/ui/が作られる。自分でコード記述したわけではない。
//カスタマイズしたい場合は編集する。
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useEffect, useRef, useState } from "react";



interface ImageRef {
  imageId: string;
  filename: string;
  imageUrl: string;
  score: number;
}//これはレスポンスの型。ではなく画像だけ抽出した型。
//typeとinterfaceは違いほぼない。
//typeはunion型作れる。type Status = "loading" | "done" | "error";
//普通はrequestの型も作る。
//レスポンスの型はzodで作って、リクエストの型は自分で作るのが標準。
/*zodは実行時チェックも行う。自分で定義した場合
type SearchRequest = { query: string };                                                                                                    
  const { query } = (await req.json()) as SearchRequest; 
  tscでエラーになるが実行時にはエラー出ない*/
  

  /*api側は
   {
    id: "abc",
    role: "assistant",
    parts: [
      { type: "text", text: "この画像は赤い花です..." },
      { type: "text", text: "<!--IMAGES:[...]-->" },
    ]
  }を返す。ここでは*/
function getTextFromParts(parts: { type: string; text?: string }[]): string {
  //レスポンス側を思い通りに定義しててもこれから仕様が変わるかもしれない。
  //ゆえに受け取り側も型定義する。parts: { type: string; text?: string }[])
  //防御的プログラミング。画像の場合textがないからオプショナルにしている。
  return (parts ?? [])//実際には[]にならない。
    .filter((p) => p.type === "text" && p.text)//return してからfilterでチェーンする記法慣れる。
    .map((p) => p.text)//filterで画像を消してからmapでテキストを並べる。
    .join("");
    //現状テキストの途中で画像が入ってその後テキストが始まる場合に対応するためにfilterしてjoinにしてるけど
    //そもそも画像をpartsの中で返す設計にしてない。
    //まずテキストの中に画像含まないようにLLMへのプロンプトで制御したらいい。
    // コメントの中に画像含めて返してる。これも設計微妙
    //TODO:joinとかなくてもいい。そもそもtextだけ返す設計。
}

function parseImages(text: string): {//画像部分抽出。
  cleanText: string;
  images: ImageRef[];
} {
  const match = text.match(/<!--IMAGES:(.*?)-->/s);//画像部分取り出す。
  if (!match) return { cleanText: text, images: [] };//該当画像なしの場合。

  try {
    const images = JSON.parse(match[1]) as ImageRef[];
    //JSON.parseは不正なJSONが来ると例外を投げる。今回のjsonはLLMが作ったやつやから信頼できない.
    //ゆえにtryで囲む。信頼できるjsonならばtryするか議論。
    //これjson.parseの戻り値はanyやからasで型付ける。これは標準。
    //でも厳密に設計するならばzod使う。
    //実務ではフロント側はzod使わずにasで対応することが多い。
    /*text.matchの返り値は
     match[0] = "<!--IMAGES:[{\"imageId\":\"xxx\"}]-->"  ← マッチ全部                                                                        
   match[1] = "[{\"imageId\":\"xxx\"}]" ゆえにmatch[1]を使う。
    */
    const cleanText = text.replace(/<!--IMAGES:.*?-->/s, "").trim();
    return { cleanText, images };
  } catch {
    //TODO:ここキャッチするだけでログも何も出してないのやばい。
    return { cleanText: text, images: [] };
  }
}

export default function ImageChatPage() {
  //命名何でもいい。nextが自動でページ設定してくれる。default export必須。
  //default exportでは適当な名前つけてimportできる。
  //named exportは名前合わせる。
  const [input, setInput] = useState("");
  //画面の表示に関わる、かつ既存のstateから計算できない独立した値はuseState。

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/image-chat",
    }),//これは中でapi叩いてresult.toUIMessageStreamResponseの結果をストリーミングでmessagesに格納する。ai-sdk
    //sendmessage()が使われたときにuseChatが動く。
    //usechatはrequestとresponse両方行う。
    //api側はmessagesをストリーミングで返す、受け取る側ではmessagesが変わるためにレンダリングして結果ストリーミングになる。
    //差分を取っていいるわけではない。
  });

  const isLoading = status === "streaming" || status === "submitted";
  //statusは"idle" — 何もしてない、"submitted" — 送信済み、応答待ち、 "streaming" — ストリーミング受信中、"error" — エラー発生
  //statusがstreamingあるいはsubmittedの場合isLoadingをtrueにする。
  //普通はisLoadingはuseStateで宣言するが今回は既存のstateから計算できる。stateが変わればレンダリングされるからusestate使わない。
  //statusが変わる → コンポーネント再レンダリング → const isLoading = ...が再計算される → 画面変わる  

  const scrollRef = useRef<HTMLDivElement>(null);
  //回答が生成されるとスクロールする。ここは初期値nullで宣言してる。scrollRef = { current: null } 
  //divタグにつけること可能で宣言。<input>に紐づけたい場合はuseRef<HTMLInputElement>(null)
  const [expandedImages, setExpandedImages] = useState<Set<string>>(new Set());
  //表示する画像のズームを制御する。setの中にimage1があればそれはズーム。
  //配列にした場合は操作系が複雑になる。.includesはO(n)
  //setで扱うと操作系が簡単。.hasはO(1)
  //usestate<>()の <>は型パラメータ。扱うデータの型を宣言している。
  //useState("") ではtsがstring型と断定できる。
  //今回はnew set()でSet<unknown>を宣言。これは型が分からないからSet<string>で宣言している。


  useEffect(() => {
    //初回レンダリングの際はcurrentがnullであるからオプショナルチェイニングにしている。
    //存在しない場合パスっていうのをif使わずに簡単に記述できるのがオプショナルチェイニング。
    //messagesがストリーミングで変わるたびにスクロール。
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",//アニメーションでスクロール。
    });
  }, [messages]);
  //useeffectは関数実行するタイミングを決める。今回はmessagesが変わるたびに実行。

  const toggleImage = (id: string) => {
    setExpandedImages((prev) => {
      //prevは例えばこれ。Set { "image-id-1" }    
      const next = new Set(prev);//ここはまだ追記してない。prevのコピーを作ってるだけ。
      //new Set()に既存のSetを渡すと中身をコピーした新しいSetが作られる
      //コピーなしの場合、prev.add(id); で return prev;これはreactが変わってないと判断して再レンダリングしない。
      //ゆえにコピー作る。
      //ここから分岐
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = (text: string) => {
    //request部分。
    if (!text.trim() || isLoading) return;
    //スペースだけの場合、作業中の場合(連打防止)はreturn
    //でもそもそもdisabled={!input.trim()}とdisabled={isLoading}にしてるからreturnに到達しない
    //いやでもボタン押さずにenter押した場合到達する。
    /*TODO:その場合にユーザーに何か返したほうが良い。
     if (!text.trim()) {
    toast.error("メッセージを入力してください");
    return;
  }*/
      sendMessage({
      role: "user",
      parts: [{ type: "text", text }],
      //textは省略記法。キー名と変数名が同じなら省略可能。
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
      <div
      //ここでスクロールの部分を注入。scrollRef = { current: div } 
       ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
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
