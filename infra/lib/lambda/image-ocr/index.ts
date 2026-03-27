import {
  BedrockRuntimeClient, // Bedrock API への接続クライアント
  InvokeModelCommand,// モデルを呼び出すコマンド（Claude に画像を送る）
} from "@aws-sdk/client-bedrock-runtime";
import {
  //s3系
  GetObjectCommand,// S3 からファイルを取得（rawBucket から画像を読む）
  PutObjectCommand, // S3 にファイルを置く（dataSourceBucket にテキストを書く）
  S3Client, // S3 API への接続クライアント
} from "@aws-sdk/client-s3";
/* AWS SDK はクライアント+コマンドのパターンで統一されている

  const client = new S3Client({});              // クライアント作る
  const command = new GetObjectCommand({ ... }); // コマンド作る
  const result = await client.send(command);     // 送信
*/ 
import type { S3Event } from "aws-lambda";
/*S3イベントで Lambda が受け取るデータの型定義だけをインポートしてる。多くの型が存在する。
  import type { S3Event } from "aws-lambda";       type = 型だけ。
export const handler = async (event: S3Event) => {*/
/*S3Event の型:

  {
    Records: [
      {
        s3: {
          bucket: { name: "bedrock-kb-test-raw-..." },
          object: { key: "raw-images/uuid/photo.png" }
        }
      }
    ]
  }*/
//import type はesbuild でバンドルされる時には消える。

const bedrock = new BedrockRuntimeClient();
const s3 = new S3Client();
//接続(コールドスタート)は時間かかるからhandlerの外で接続する->2回目以降の接続が再利用になって効率的。

const RAW_BUCKET = process.env.RAW_BUCKET!;
const DATA_SOURCE_BUCKET = process.env.DATA_SOURCE_BUCKET!;
const VLM_MODEL_ID = process.env.VLM_MODEL_ID!;
//これも毎回読まないからhandlerの外で読む。
// process.env の戻り値は string | undefined これを引数に与えるとTSエラー->非nullアサーションでstringにしている
//stack側で与えた引数。

const SUPPORTED_EXTENSIONS = new Set([// Bedrockの Claude が対応してる画像フォーマットの一覧->ハードコードでいい
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
]);//arrayではなくset使ってる->計算が早い(include O(n)ではなくhas O(1))。変わらないリストはsetにする。
/* const arr = [".jpg", ".png"];         Array
  const set = new Set([".jpg", ".png"]);  Set
*/ 


//パラメータについて。 迷ったらconst、再代入が必要になったらletに変える、
export const handler = async (event: S3Event) => {
  //cdkスタックではなくaws-sdkはs3操作とかを簡単に扱う。
  //中でawait(aws-sdkは非同期)を使ってる->handlerはasync
  //event: S3EventはeventトリガーでAWSが自動で与えてる。rawバケットのraw-imageに保存でトリガー
  for (const record of event.Records) {
    //イベントが多い場合一つずつ扱う
    //keyはwebのアップロードUIで決めてる。raw-images/${imageId}/${filename}
    //AWSはイベントで与えるときURLエンコード、スペースを+に変える。httpベースで行われるからエンコードしなければならない。
    //decode、+変換
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  
    const parts = key.split("/");
    // split は string 型が持つメソッドっていう言い方であってる。
    if (parts.length < 3) {//これイベント複数で途中でキーが不正の場合にスキップするためにアプリ落とさない設計。
      console.error(`Unexpected key format, skipping: ${key}`);
      //console.log   → INFO レベル 
      // console.error → ERROR レベル
      /*実務では構造ログにする。 
  console.error(JSON.stringify({
    level: "error",
    message: "Unexpected key format",
    key: key,
    timestamp: new Date().toISOString(),
  }));これで検索しやすい*/
      continue;
    }

    const imageId = parts[1];
    const filename = parts[2];
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    /* filename = "Photo.PNG"
  filename.lastIndexOf(".")  // → 5（最後の . の位置）
  filename.slice(5)          // → ".PNG"
  .toLowerCase()             // → ".png"*/

    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      //一つ不正な拡張子があってもアプリは落とさない(thorow)しない設計。
      console.error(`Unsupported extension, skipping: ${key}`);
      continue;
    }

    console.log(`Processing: ${imageId}/${filename}`);
    //lambdaではlog入れる。AWSで動いてるからアプリ側から見れない。Cloudwatchで見る->面倒。

    try {
      // 1. S3 から画像バイナリを取得
      //AWS SDK v3の型はクライアント+コマンド(object)。s3.getObject()ではない。保存も取得もsend。
      const imageObj = await s3.send(
        //await->Promiseは解決済み。型はGetObjectCommandOutput。
        new GetObjectCommand({ Bucket: RAW_BUCKET, Key: key }),
        //これでbodyは存在する。何らかの問題でオブジェクトないときはGetObjectCommandがエラー投げて終わる。
        //ゆえに非nullで問題ない。!がつぶしてるのはGetObject成功したけどBodyがないというありえないケース
        //バケットとkeyで扱う。
      );
      const imageBytes = await imageObj.Body!.transformToByteArray();
      //bodyはストリーム。まずはバイト配列に変換する。
      //ストリームから全データを読み終わるのに時間がかかる。だからtransformToByteArrayも非同期。 ゆえにawait。
      //bodyは型ではundefinedあり得る。！にして非nullにすることでtsの警告がなくなる。別に！なくても動く。
      const base64Image = Buffer.from(imageBytes).toString("base64");
      //バイト配列->base64
      //bufferはNode.js環境で標準で使える。lambdaはnodejs22で動いてるからok。ブラウザにbufferはない。
      //そもそもnodeってのはjsからエンジンだけを取り出したやつ。
      //サーバーサイドをnodeで動かす。->tsでフロントもサーバーも作れる。->Nextjs
      //サーバーがそこまで重くないアプリでNodeは強い。
      //サーバーサイドだけではなくCLI、Lambdaもnodeで行う。
      const mediaType = resolveMediaType(ext);
//Claude Vision APIは画像をbase64で受け取る仕様。
      // 2. Claude Vision で OCR +
      const isPdf = ext === ".pdf";//三項演算子使うためのisPdf
      const analysis = await analyzeImage(base64Image, mediaType, isPdf);
      //定義したasyncのf(x)をawaitで受け取る。
      console.log(
        `Analysis done — ocr: "${analysis.ocrText.slice(0, 60)}", desc: "${analysis.description.slice(0, 60)}"`,
      );

      // 3. テキストを dataSourceBucket に保存
      const textContent = [
        //どういう形式で保存するかは決まってるわけではない。今回はmd形式で保存してる。
        //TODO:検討。
        `# Image: ${filename}`,
        "",
        "## OCR Text",
        analysis.ocrText || "(no text found)",
        //||   → falsy なら右側。 ??   → null/undefined だけ右側 今回は""の場合を拾いたいから||を使う。
        "",
        "## Description",
        analysis.description,
        "",
        `## Metadata`,
        `- imageId: ${imageId}`,
        `- filename: ${filename}`,
        `- s3Key: ${key}`,
        `- processedAt: ${new Date().toISOString()}`,
        //ISO形式の文字列で取得。ISO形式はタイムゾーンに依存しない。ログやメタデータでよく使う。
      ].join("\n");
/*["a", "b", "c"].join(",")   // → "a,b,c"
  ["a", "b", "c"].join(" ")   // → "a b c"
  ["a", "b", "c"].join("")    // → "abc"
  さらに""を配列に入れることで一行作る。*/ 
  /*Raw Bucket:        raw-images/{imageId}/{filename}。
  DataSource Bucket: images/{imageId}.txt 
  これrawbucketは両方いる。imageIdの場合最終元の画像表示できない。filenameだけやと一意ではない。
  

   */
  //TODO:いや嘘や。filenameいらん。今はフロントでファイル名表示してるけど別になくてもいい。
  //TODO:images/{imageId}.txtのkeyわかりにくい。analysed/{imageId}.txtとかのほうが良い。
      await s3.send(
        new PutObjectCommand({
          Bucket: DATA_SOURCE_BUCKET,
          Key: `images/${imageId}.txt`,
          Body: textContent,
          ContentType: "text/plain; charset=utf-8",
        }),
      );

      console.log(`Done: ${imageId}/${filename} -> images/${imageId}.txt`);
    } catch (err) {
      console.error(`Failed to process ${imageId}/${filename}:`, err);
    }
  }
};

async function analyzeImage(
  base64Image: string,
  mediaType: string,
  isPdf: boolean,
): Promise<{ ocrText: string; description: string }> {
    //asyncだから自動的にPromiseでwrapする。解決するとocrTextとdescriptionを持つオブジェクトが返る。
  const fileContent = isPdf
  //三項演算子。ここでifを使うとletでfileContentを宣言することになる。三項演算子ではconst宣言可能。
    ? {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: base64Image,
        },
      }
    : {
      //as const->リテラル型にする。as constなしではstringになってエラーになる。
      /*Claude Vision APIが期待する型                                                                                                    
  // 画像の場合                                                                                                                             
  {
    type: "image",              // "image" リテラルのみ。stringは不可。
    source: {
      type: "base64",           // "base64" リテラルのみ
      media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: string,
    }
  }*/
 //しかしmediaTypeはstringでありリテラルではない。->エラー出る。
 //実際はエラー出ない。そもそもobjectをjson.stringfy(any受け取り)でjsonに変換(string)してからbedlock sdk(string受け取る)に与えてそこでclaude api使う。
 //そこでcloud visonがエラー出るかどうか。つまり型の概念はstringfyでつぶしてる。
 //だから今回のas constはあくまで防御の一部分でありなくてもエラー出ない。さらにすでに5種類に絞ってる(真の防御)から今回ではas constなしでいい。
 //TODO:as const使わない。
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaType,
          data: base64Image,
        },
      };

  const response = await bedrock.send(//クライアント+オブジェクト
    new InvokeModelCommand({
      modelId: VLM_MODEL_ID,
      //HTTPのContent-TypeとAcceptヘッダーと同様。
      contentType: "application/json",//リクエスト形式
      accept: "application/json",//レスポンス形式
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31", // Bedrock版Claude APIのバージョン指定
        max_tokens: 2048,// 最大出力トークン数。1500〜2000文字
        //マルチモーダルで画像とテキスト与える。これができないとOCRできない。
        messages: [
          {
            role: "user",
            content: [
              fileContent,
              {
                type: "text",
                text: `この画像を分析してください。以下の2つの情報をJSON形式で返してください。

1. "ocrText": 画像内に表示されているテキストをすべて抽出（テキストがない場合は空文字列）
2. "description": 画像の内容を詳しく説明（写っているもの、場所、テーマ、色調、雰囲気など）

JSONのみを返してください（コードブロック不要）:
{"ocrText": "...", "description": "..."}`,
              },
            ],
          },
        ],
      }),
    }),
  );
//レスポンス形式はjsonやけどbodyはバイト配列( [123, 34, 99, 111, 110, 116, ...])。

  const body = JSON.parse(new TextDecoder().decode(response.body));
  //TextDecoderはTextDecoder("shift-jis")でエンコーディング決めれるからこれはインスタンス使う。f(x)ではない。
  //さっきはbuffer使ってた。 Buffer.from(response.body).toString("utf-8")
  //JSON.stringifyはオブジェクトから文字。JSON.parseは文字からオブジェクト。オブジェクトは.でアクセス可能。
  //LLMの返り値からbodyだけを返す。
  //TODO:メリットデメリット考察して統一する。

  const text: string = body.content?.[0]?.text ?? "{}";
  //?.はオプショナルチェイニング。途中でundefinedになったらエラーにせずundefinedを返す。
  //??でどれかがundefinedならば{}でフォールバック。
//trycatchはエラーの制御フロー。consoleのログとは別。tryでエラー起きてもcatchで受け取ってアプリを落とさない。
//finallyはtry catchの成功失敗にかかわらず実行するブロック。リソースの解放。
//throwはエラーを定義する側。try catchは受け取る側。
//今回のLambdaではthrowせずにcontinueでスキップする。throwすると呼び出し元までエラーが伝播して別の画像に対するタスク止まる。
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    // text.matchは配列を返す。ゆえにjsonMatch[0]で文字にする。
    //Regで{}を抽出。AIが文字を生成してるかもしれないから削る。
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      /* jsonMatch[0]:
    '{"ocrText": "hello", "description": "写真です"}'
    parsed:
    { ocrText: "hello", description: "写真です" }
    オブジェクト。parsed.ocrText でアクセスできる*/
      return {
        ocrText: String(parsed.ocrText ?? ""),//stringで返す。フォールバック。
        //よくある設計判断。存在しないならフォールバック(アプリ続行)あるいはthrowでアプリ止める
        // if (!parsed.ocrText) throw new Error("ocrTextがない");
        description: String(parsed.description ?? ""),
      };
    }
  } catch {
    //catch(e)はエラーが格納される。エラーオブジェクト使わない場合はcatch
    console.error("Failed to parse VLM response:", text.slice(0, 200));
  }

  return { ocrText: "", description: text };
  //パース失敗でテキストだけ返す設計。フォールバック。
}

//MIMEタイプ。カテゴリ/種類という形式で、ファイルの種類をテキストで表現するルール。これをclaude visionに与える。
//PDFはカテゴリが違う。application/pdf。全部で5種類。
function resolveMediaType(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  return "image/jpeg";
}
