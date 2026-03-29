import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { awsCredentials, awsRegion } from "@/lib/aws";

//kbにクエリ投げるとaws側でpineconeで検索して結果を返す。
// そのテキストからimageIDのデータだけとって読み取り許可するpresignedurl発行するapi
//さっきはputのpresignedurl、今回はreadのpresignedurl
const client = new BedrockAgentRuntimeClient({
  //TODO:命名良くない。
  region: awsRegion,
  ...awsCredentials,
});

const s3 = new S3Client({
  region: awsRegion,
  ...awsCredentials,
});

const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID!;
const RAW_BUCKET = process.env.RAW_IMAGE_BUCKET!;

export async function POST(req: Request) {
  //ここでのtry catchは結果が存在しない場合続行できないからcatchでresponse返す。
  try {
    const { query } = (await req.json()) as { query: string };
    //TODO:zodバリデーション。

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    console.log("Searching KB:", KNOWLEDGE_BASE_ID, "query:", query);

    const result = await client.send(
      //SDK+オブジェクトのパターン。
      new RetrieveCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            //バイブリッド検索。 セマンティック検索（ベクトル検索）＋ キーワード検索（全文検索）
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
    // RetrieveCommand → Bedrock KB → Pinecone検索 → Bedrock KBが結果を整形 → retrievalResults
    //pineconeにはベクトルとmdが両方保存されてる。
    //pineconeの検索は新しく自然言語で結果を生成してるわけではなく、該当する画像のmdをkbを通して返す。
    const images = (result.retrievalResults ?? [])
      //検索結果が0件は正常なケース。該当画像なし。アプリ落とさない。
      .map((r) => {
        const text = r.content?.text ?? ""; //md
        const score = r.score ?? 0;

        // メタデータからimageId, filename, s3Keyを抽出。自分が保存したmd。
        const imageIdMatch = text.match(/imageId:\s*(.+)/);
        /*テキスト: "imageId: 550e8400-xxxx" 
  [0] "imageId: 550e8400-xxxx"  ← 正規表現にマッチした部分全体
  [1] "550e8400-xxxx"            ← 括弧の中にマッチした部分だけ*/
        const filenameMatch = text.match(/filename:\s*(.+)/);
        const s3KeyMatch = text.match(/s3Key:\s*(.+)/);
        const descMatch = text.match(/## Description\n([\s\S]*?)(?:\n## |$)/);

        const imageId = imageIdMatch?.[1]?.trim();
        //ここでテキスト部分を取り出してからスペース消してる。
        //オプショナルチェイニングにして存在しない場合でもアプリ落とさずifでエラーログ出力
        const filename = filenameMatch?.[1]?.trim();
        const s3Key = s3KeyMatch?.[1]?.trim();
        const description = descMatch?.[1]?.trim() ?? "";
        //ここはなくても動く。なくても動かしてるけど想定はしていない。
        //TODO:エラーは出すべき

        if (!imageId || !s3Key) return null;
        //TODO:ここは存在しない場合はエラー出すべき

        return { imageId, filename: filename ?? "", s3Key, description, score };
        //ここはapiレスポンスではなくmapの中のレスポンス。nullの場合はfilterではじく。
      })
      .filter(Boolean);
      //自分自身のチェーンの型を使う設計は微妙。const parsed = (...).map(...).filter(Boolean) as typeof parsed;
    //imagesが完成。
    /*TODO:親切じゃない設計。kbはデータ返したのにimagesは0件の場合とそもそもkbがデータ返してない場合の分岐ができない。
      ログ記述した方が良い*/

    // presigned GET URLを生成
    const imagesWithUrls = await Promise.all(
      //5個のurl生成は遅い->promise.allで並列に実行してる。
      //非同期処理が複数あってお互い依存していない(1件目の結果が2件目に必要とかではない）場合Promise.allで並列にするのが標準。
      //実際にはJavaScriptはシングルスレッドやから、CPUで同時に計算してるわけじゃない。待ち時間を重ねてるだけ。
      images.map(async (img) => ({
        ...img,
        imageUrl: await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: RAW_BUCKET, Key: img!.s3Key }),
          //非nullってのは実行時には消える。img.s3Keyの場合実行はできるけどtscがエラーを出す
          { expiresIn: 3600 },
        ),
      })),
    );

    return NextResponse.json({ images: imagesWithUrls, query });
    //TODO:これqueryいらない。フロントで使ってない。
  } catch (error) {
    //catch(e)と同様。
    console.error("Image search error:", error);
    return NextResponse.json(
      { error: String(error) },
      //errorはunknown型。
      //nextは実質json.stringifyを実行しているがerrorがオブジェクトの時はJSONにすると中身なしになる。
      //ゆえにerrorをstringにして対応している。
      { status: 500 },
    );
  }
}
