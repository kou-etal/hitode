import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromSSO } from "@aws-sdk/credential-provider-sso";
import { convertToModelMessages, streamText } from "ai";
import { awsCredentials, awsRegion } from "@/lib/aws";

const kbClient = new BedrockAgentRuntimeClient({
  region: awsRegion,
  ...awsCredentials,
});

const s3 = new S3Client({
  region: awsRegion,
  ...awsCredentials,
});

const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID!;
const RAW_BUCKET = process.env.RAW_IMAGE_BUCKET!;

const profile = process.env.AWS_PROFILE;
const bedrockProvider = createAmazonBedrock({
  //これはAI SDK用。
  //AWS SDKはクラスベース（new使う)。AI SDKは関数ベース（関数呼び出し）
  //最近のJavaScriptはnewよりファクトリ関数（createXxx）が使われること多い。
  region: awsRegion,
  ...(profile ? { credentialProvider: fromSSO({ profile }) } : {}),
  /*これ冗長。AI SDKは使う側の変数名にProviderがあるから現状ヘルパー使えない。
  /TODO:  export const awsCredentialProvider = profile ? fromSSO({ profile }) : undefined;
  export const awsCredentials = awsCredentialProvider ? { credentials: awsCredentialProvider } : {};
で途中結果をexportする。*/
});

//これはユーザーの入力からテキストを取り出す部分。
/*AI SDKのバージョンアップでメッセージの形式が変わった。
  // 旧バージョン: contentに文字列  { role: "user", content: "猫の画像を探して" }
  // 新バージョン: partsの配列      { role: "user", parts: [{ type: "text", text: "猫の画像を探して" }] }
新しい形式では、テキスト以外（画像とか）も1つのメッセージに含めることできる
現状ではAI SDK側は画像に対応してるけどUIが対応していない。
*/
//anyの警告を消す。

//eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextFromMessage(msg: any): string {
  //zodは外部からの入力（APIリクエスト等）を実行時にチェックしたいときに使う。現状anyを許容してる。
  //これは旧バージョンと新バージョン両方に対応するため。
  /*でもanyを消したい場合はunion型で十分：                                                                                                            
  type Message =
 | { parts: { type: string; text?: string }[] }                                                                                           
 | { content: string }; */
  //そもそも新バージョンしか使ってないから旧バージョンに対応する必要ない。
  //import type { UIMessage } from "ai";　extractTextFromMessage(msg: UIMessage):これでいい
  if (msg?.parts) {
    //Optional Chainingはmsgが存在するかだけなく、msg.partsが存在するかもチェックする。どれかが欠けたらundefined
    return msg.parts
      .filter(
        (p: { type: string; text?: string }) => p.type === "text" && p.text,
      )
      .map((p: { type: string; text?: string }) => p.text)
      .join("");
  }
  if (typeof msg?.content === "string") return msg.content;
  return "";
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    //現状の設計ではセッションのmessageすべてをリクエストに含める。そしてLLMには全文与えてBedlockには最新の一件だけ与える。
    //セッションの内容をフロントエンドが持っている。ハッカソンで簡単に作るためにDBを立てていない。サーバーレス。
    //だからセッション長くなるとかなり重くなる。リクエストに含める内容も増える。
    //普通GeminiとかClaudeはサーバーに中身を置いてる。
    //TODO:DB作ってもいい。

    //最新の一件を取得。
    /*messagesは配列。 messages = [                                                                                                                                                                                                                                          
    { role: "assistant", parts: [...] }, 
    { role: "user", parts: [...] },   
  ]*/
    //ゆえに{...}オブジェクトのコピーではなく[...]配列のコピー、
    //reverseは配列が崩れるからコピーに対して行う。
    const lastUserMessage = [...messages]
      .reverse()
      .find((m: { role: string }) => m.role === "user");
      //TypeScriptの型は最低限これを持ってればOKの型。完全一致ではない。
      //(m: { role: string })で{ role: string }部分を取ってからuserの部分を返す。
      //.find()は条件に合う最初の1件を返す
    const query = extractTextFromMessage(lastUserMessage ?? {});
//最新がないのに作業続けるのはよくない。完全に異常で、結果も意味ない。
//TODO:これは存在しないならログだけでなく、response返して作業止めるべき。

    let searchResults: {
      imageId: string;
      filename: string;
      s3Key: string;
      description: string;
      score: number;
      imageUrl: string;
    }[] = [];
//検索結果を入れる型を中身なしの配列で作ってる。
//let searchResults: ImageResult[] = [];
// image-searchでは検索結果をresponseで返すからletで宣言しない。
//image-chatでは結果をLLMに与えてからresponseで返すからいったんletで宣言する。
//いや違うわ。image-searchでもcont imagesWithUrls で宣言してる。今回はtryの外でも使うからletで宣言している。
//constの場合それができない。
//TODO:これimage-searchでも使ってるから今みたいにインラインにせずにlib/typesに型切り出したほうが良い。
    //2重でtryする。API単位のエラーハンドリングとKB検索だけのエラーハンドリング
    //KB検索は失敗しても続ける。LLMは失敗不可。

    try {
      const result = await kbClient.send(
        //TODO:これもimage-searchと共通やから切り出したほうが良い。
        //RetrieveCommandの設定はリクエストのたびに決める。CDKのスタックとは別。
        new RetrieveCommand({
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          retrievalQuery: { text: query },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              overrideSearchType: "HYBRID",
              rerankingConfiguration: {
                type: "BEDROCK_RERANKING_MODEL",
                bedrockRerankingConfiguration: {
                  numberOfRerankedResults: 5,
                  modelConfiguration: {
                    modelArn: `arn:aws:bedrock:${awsRegion}::foundation-model/amazon.rerank-v1:0`,
                  },
                },
              },
            },
          },
        }),
      );

      const parsed = (result.retrievalResults ?? [])
        .map((r) => {
          const text = r.content?.text ?? "";
          const score = r.score ?? 0;
          const imageIdMatch = text.match(/imageId:\s*(.+)/);
          const filenameMatch = text.match(/filename:\s*(.+)/);
          const s3KeyMatch = text.match(/s3Key:\s*(.+)/);
          const descMatch = text.match(/## Description\n([\s\S]*?)(?:\n## |$)/);

          const imageId = imageIdMatch?.[1]?.trim();
          const filename = filenameMatch?.[1]?.trim();
          const s3Key = s3KeyMatch?.[1]?.trim();
          const description = descMatch?.[1]?.trim() ?? "";

          if (!imageId || !s3Key) return null;
          return {
            imageId,
            filename: filename ?? "",
            s3Key,
            description,
            score,
          };
        })
        .filter(Boolean) as typeof searchResults;
        //ここではimage-searchの非null!ではなくtypeof searchResultsで非nullを伝えてる。
        //typeof searchResultsはこれがsearchResultsであること宣言。
        

      searchResults = await Promise.all(
        //これは型に当てはまらない場合tscでエラーでる。でもnext.config.tsでignoreBuildErrors: true,にしてるからビルドできる。
        //TODO:falseにすべき。型エラーあるのにビルドは危険。
        parsed.map(async (img) => ({
          ...img,
          imageUrl: await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: RAW_BUCKET, Key: img.s3Key }),
            { expiresIn: 3600 },
          ),
        })),
      );//TODO:ここも共通で切り出す。
    } catch (e) {
      console.error("KB search failed:", e);
      //ここはなくてもアプリ止めない。
    }

    const contextText =
      searchResults.length > 0
        ? searchResults
            .map(
              (img, i) =>
                `[画像${i + 1}] ID: ${img.imageId}, ファイル名: ${img.filename}, スコア: ${img.score.toFixed(3)}\n説明: ${img.description}`,
            )
            .join("\n\n")
        : "該当する画像が見つかりませんでした。";
        //珍しい、tsのmapでは第一引数が中身で第二引数がインデックス。Goとは違う。
        //LLMが見やすいように画像1とか付与している。toFixed(3)でfloatの有効数字3桁にしている。
        /*2回改行することで
        画像1のデータ

        画像2のデータ

        画像3のデータで見やすくしてる。mapした後にjoin。
         ["画像1のデータ", "画像2のデータ", "画像3のデータ"].join("\n\n")    
 
        */
        /*TODO:検索結果0件は異常ではないけど怪しいからwarnのログぐらいは出力したほうが良い。
        if (searchResults.length === 0) {
    console.warn("No search results for query:", query);
  }*/

    const imageListJson = JSON.stringify(
      searchResults.map((img) => ({
        imageId: img.imageId,
        filename: img.filename,
        imageUrl: img.imageUrl,
        score: img.score,
      })),
      //検索結果をJSONにしてLLMの出力に埋める。JSONではなくテキストで与えた場合読み取りが大変。
      //TODO:そもそも出力に画像データ含めるの微妙。別にResponseに含めればいい。
    );

    const result = streamText({
      model: bedrockProvider("us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
      system: `あなたは画像検索アシスタントです。ユーザーの質問に対して、検索された画像データベースの結果をもとに回答してください。

検索結果:
${contextText}

回答のルール:
- 検索結果の画像について、関連性が高い順に紹介してください
- 各画像の説明文をもとに、なぜその画像が関連しているか説明してください
- 検索結果がない場合は、その旨を伝えてください
- 日本語で回答してください

重要: 回答の最後に必ず以下の形式で画像データを含めてください（これはUIで画像表示に使われます）:
<!--IMAGES:${imageListJson}-->`,
      messages: convertToModelMessages(messages),
      //ここでユーザーが作ったテキストをLLMが受け取る形式にしている。
      /*  フロントから来る形式（UIMessage）                                                                                                         {                                                                                                                                          
    id: "abc",                                          
    role: "user",
    parts: [{ type: "text", text: "りんごの画像を探して" }],
  }*/
    });
    //${imageListJson}のimageUrlがpresigned URLやからブラウザは${imageListJson}さえあれば直接アクセスして画像を取得できる。   
//TODO:そもそも${imageListJson}はLLMの出力に含めずにResponseに含めるほうが良い。
    return result.toUIMessageStreamResponse();//ai-sdk
  } catch (error) {
    //ここはアプリ止める。
    console.error("image-chat error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });//TODO:NextResponseに統一するべき
  }
}
